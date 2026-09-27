import { tool } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../logging/jsonl-logger.js', () => ({
  writeInteractionLog: vi.fn().mockResolvedValue('/fake/logs/ingest.jsonl'),
}));

import { writeInteractionLog } from '../logging/jsonl-logger.js';
import { INGEST_AGENT_SYSTEM_PROMPT } from './ingest-agent-prompt.js';
import { ingestProduct } from './ingest-agent.js';

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

type MockDoGenerate = NonNullable<
  ConstructorParameters<typeof MockLanguageModelV2>[0]
>['doGenerate'];
type MockStep = Extract<MockDoGenerate, unknown[]>[number];

function step(
  finishReason: 'stop' | 'tool-calls',
  content: MockStep['content'],
): MockStep {
  return { finishReason, usage, warnings: [], content };
}

function toolCall(toolName: string, input: unknown, toolCallId: string) {
  return {
    type: 'tool-call' as const,
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  };
}

function fakeTools() {
  const scrape = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      data: { items: [{ handle: 'ficus-lyrata-9cm' }] },
    });
  const upsert = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      data: { inserted: ['ficus-lyrata-9cm'], updated: [] },
    });
  const anyInput = z.record(z.string(), z.unknown());
  return {
    scrape,
    upsert,
    tools: {
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
    },
  };
}

describe('ingestProduct', () => {
  beforeEach(() => vi.mocked(writeInteractionLog).mockClear());

  it('should scrape, then upsert, then answer — and log the interaction', async () => {
    const { scrape, upsert, tools } = fakeTools();
    const model = new MockLanguageModelV2({
      doGenerate: [
        step('tool-calls', [
          toolCall(
            'scrapeProducts',
            { source: 'tropicalhome.hu', match: 'ficus' },
            'c1',
          ),
        ]),
        step('tool-calls', [
          toolCall(
            'upsertProducts',
            { products: [{ handle: 'ficus-lyrata-9cm' }] },
            'c2',
          ),
        ]),
        step('stop', [{ type: 'text', text: '1 új fikusz került be.' }]),
      ],
    });

    const result = await ingestProduct('frissítsd a fikuszokat', {
      model,
      tools,
    });

    expect(result.answer).toBe('1 új fikusz került be.');
    expect(result.toolCalls).toEqual(['scrapeProducts', 'upsertProducts']);
    expect(scrape).toHaveBeenCalledWith(
      { source: 'tropicalhome.hu', match: 'ficus' },
      expect.anything(),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result.system).toBe(INGEST_AGENT_SYSTEM_PROMPT);
    expect(result.logPath).toBe('/fake/logs/ingest.jsonl');
    expect(writeInteractionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        system: INGEST_AGENT_SYSTEM_PROMPT,
        response: '1 új fikusz került be.',
      }),
    );
  });

  it('should allow up to 8 steps (more than the ask-agent default of 6)', async () => {
    const { tools } = fakeTools();
    const scrapeStep = (id: string) =>
      step('tool-calls', [
        toolCall('scrapeProducts', { source: 'thesill.com' }, id),
      ]);
    const model = new MockLanguageModelV2({
      doGenerate: [
        ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(scrapeStep),
        step('stop', [{ type: 'text', text: 'kész' }]),
      ],
    });

    await expect(
      ingestProduct('mindent', { model, tools }),
    ).resolves.toMatchObject({ answer: 'kész' });
  });

  it('should reject an empty request before calling the model', async () => {
    const doGenerate = vi.fn();
    const model = new MockLanguageModelV2({ doGenerate });

    await expect(ingestProduct('', { model })).rejects.toThrow(/empty/);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('should register only the two ingest tools by default (no read-only ask tools)', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: [step('stop', [{ type: 'text', text: 'ok' }])],
    });

    await ingestProduct('csak nézz körül', { model });

    const offered = (model.doGenerateCalls[0].tools ?? [])
      .map((t) => t.name)
      .sort();
    expect(offered).toEqual(['scrapeProducts', 'upsertProducts']);
  });
});
