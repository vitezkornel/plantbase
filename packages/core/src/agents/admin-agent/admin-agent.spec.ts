import { tool } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../logging/jsonl-logger.js', () => ({
  writeInteractionLog: vi.fn().mockResolvedValue('/fake/logs/run.jsonl'),
}));

import { writeInteractionLog } from '../../logging/jsonl-logger.js';
import { ingestProduct } from '../../ingest/ingest-agent.js';
import { INGEST_AGENT_SYSTEM_PROMPT } from '../../ingest/ingest-agent-prompt.js';
import { createIngestProductTool } from '../../tools/ingest-product/ingest-product-tool.js';
import { ADMIN_AGENT_SYSTEM_PROMPT } from './admin-agent-prompt.js';
import { adminAgent } from './admin-agent.js';

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

type MockDoGenerate = NonNullable<
  ConstructorParameters<typeof MockLanguageModelV2>[0]
>['doGenerate'];
type MockStep = Extract<MockDoGenerate, unknown[]>[number];

const step = (
  finishReason: 'stop' | 'tool-calls',
  content: MockStep['content'],
): MockStep => ({
  finishReason,
  usage,
  warnings: [],
  content,
});
const toolCall = (toolName: string, input: unknown, toolCallId: string) => ({
  type: 'tool-call' as const,
  toolCallId,
  toolName,
  input: JSON.stringify(input),
});
const text = (value: string) => ({ type: 'text' as const, text: value });

describe('adminAgent', () => {
  beforeEach(() => vi.mocked(writeInteractionLog).mockClear());

  it('should delegate "tölts be 3 fikuszt" to the ingestProduct tool, which runs the inner ingest agent on its own', async () => {
    // Inner (ingest) agent: its own mock model and its own fake feed/DB tools.
    const scrape = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        items: [
          { handle: 'ficus-a' },
          { handle: 'ficus-b' },
          { handle: 'ficus-c' },
        ],
      },
    });
    const upsert = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        inserted: ['ficus-a', 'ficus-b', 'ficus-c'],
        updated: [],
        rejected: [],
        warnings: [],
      },
    });
    const anyInput = z.record(z.string(), z.unknown());
    const innerTools = {
      scrapeProducts: tool({
        description: 'scrape',
        inputSchema: anyInput,
        execute: scrape,
      }),
      upsertProducts: tool({
        description: 'upsert',
        inputSchema: anyInput,
        execute: upsert,
      }),
    };
    const innerModel = new MockLanguageModelV2({
      doGenerate: [
        step('tool-calls', [
          toolCall(
            'scrapeProducts',
            { source: 'tropicalhome.hu', match: 'ficus|fikusz' },
            'i1',
          ),
        ]),
        step('tool-calls', [
          toolCall('upsertProducts', { products: [] }, 'i2'),
        ]),
        step('stop', [text('3 új fikusz került be.')]),
      ],
    });
    const ingestTool = createIngestProductTool({
      ingestProduct: (request) =>
        ingestProduct(request, { model: innerModel, tools: innerTools }),
    });

    // Outer (admin) agent: decides to call ingestProduct, then answers.
    const outerModel = new MockLanguageModelV2({
      doGenerate: [
        step('tool-calls', [
          toolCall('ingestProduct', { request: 'tölts be 3 fikuszt' }, 'o1'),
        ]),
        step('stop', [text('Kész: 3 fikusz bekerült a katalógusba.')]),
      ],
    });

    const result = await adminAgent('tölts be 3 fikuszt', {
      model: outerModel,
      tools: { ingestProduct: ingestTool },
    });

    // The admin agent called exactly the ingest tool…
    expect(result.toolCalls).toEqual(['ingestProduct']);
    expect(result.answer).toBe('Kész: 3 fikusz bekerült a katalógusba.');
    // …and the inner agent ran its own full loop with its own prompt and tools.
    expect(innerModel.doGenerateCalls).toHaveLength(3);
    expect(innerModel.doGenerateCalls[0].prompt[0]).toMatchObject({
      role: 'system',
      content: INGEST_AGENT_SYSTEM_PROMPT,
    });
    expect(innerModel.doGenerateCalls[0].prompt[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'tölts be 3 fikuszt' }],
    });
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    // The inner agent's answer is what the outer model received as the tool result.
    const toolResultMessage = outerModel.doGenerateCalls[1].prompt.find(
      (m) => m.role === 'tool',
    );
    expect(JSON.stringify(toolResultMessage)).toContain(
      '3 új fikusz került be.',
    );
    // Both agents logged their own interaction.
    expect(writeInteractionLog).toHaveBeenCalledTimes(2);
  });

  it('should offer the four read-only ask tools plus ingestProduct by default', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: [step('stop', [text('ok')])],
    });

    await adminAgent('Milyen kategóriák vannak?', { model });

    const offered = (model.doGenerateCalls[0].tools ?? [])
      .map((t) => t.name)
      .sort();
    expect(offered).toEqual([
      'customerPreferences',
      'ingestProduct',
      'listCategories',
      'runSql',
      'searchKnowledge',
    ]);
  });

  it('should use the ask-agent prompt plus the <admin> section', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: [step('stop', [text('ok')])],
    });

    const result = await adminAgent('szia', { model });

    expect(result.system).toBe(ADMIN_AGENT_SYSTEM_PROMPT);
    expect(ADMIN_AGENT_SYSTEM_PROMPT).toContain('<role>');
    expect(ADMIN_AGENT_SYSTEM_PROMPT).toContain('<admin>');
  });

  it('should reject an empty request before calling the model', async () => {
    const doGenerate = vi.fn();
    await expect(
      adminAgent('', { model: new MockLanguageModelV2({ doGenerate }) }),
    ).rejects.toThrow(/empty/);
    expect(doGenerate).not.toHaveBeenCalled();
  });
});
