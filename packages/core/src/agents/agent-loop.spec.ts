import { tool } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolOutcome } from '../tools/tool-outcome.js';
import { runAgentLoop } from './agent-loop.js';

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

function textPart(text: string) {
  return { type: 'text' as const, text };
}

function toolCallPart(toolName: string, input: unknown, toolCallId = 'call-1') {
  return {
    type: 'tool-call' as const,
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  };
}

type MockDoGenerate = NonNullable<
  ConstructorParameters<typeof MockLanguageModelV2>[0]
>['doGenerate'];
type MockStep = Extract<MockDoGenerate, unknown[]>[number];

function makeModel(doGenerate: MockDoGenerate) {
  return new MockLanguageModelV2({ doGenerate });
}

function step(
  finishReason: 'stop' | 'tool-calls',
  content: MockStep['content'],
  usageOverride: typeof usage = usage,
): MockStep {
  return { finishReason, usage: usageOverride, warnings: [], content };
}

function makeTool(execute: (input: unknown) => Promise<ToolOutcome>) {
  return tool({
    description: 'test tool',
    inputSchema: z.record(z.string(), z.unknown()),
    execute: execute as (input: Record<string, unknown>) => Promise<ToolOutcome>,
  });
}

const baseInput = {
  maxTokens: 100,
  system: '<role>test</role>',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

describe('runAgentLoop', () => {
  it('returns the final text and token usage for a normal end_turn response', async () => {
    const model = makeModel(step('stop', [textPart('Hello there!')]));

    const result = await runAgentLoop({ model, ...baseInput });

    expect(result.finalText).toBe('Hello there!');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    // Transcript includes the original user message plus the assistant's reply.
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello there!' }],
    });
  });

  it('concatenates multiple text blocks into the final text', async () => {
    const model = makeModel(step('stop', [textPart('Part one.'), textPart(' Part two.')]));

    const result = await runAgentLoop({ model, ...baseInput });

    expect(result.finalText).toBe('Part one. Part two.');
  });

  it('throws when the model asks for a tool but none is registered, without burning a second model round-trip', async () => {
    const model = makeModel([
      step('tool-calls', [toolCallPart('runSql', {})]),
      step('stop', [textPart('recovered')]),
    ]);

    await expect(runAgentLoop({ model, ...baseInput })).rejects.toThrow(
      /unknown tool/i,
    );
    // stopWhen must cut the loop short right after the unknown-tool step —
    // the second scripted ('recovered') response must never be consumed.
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('throws when the model requests a tool name that is not registered, without burning a second model round-trip', async () => {
    const tools = { runSql: makeTool(vi.fn()) };
    const model = makeModel([
      step('tool-calls', [toolCallPart('someOtherTool', {})]),
      step('stop', [textPart('recovered')]),
    ]);

    await expect(runAgentLoop({ model, ...baseInput, tools })).rejects.toThrow(
      /unknown tool/i,
    );
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('throws when the response has no text content', async () => {
    const model = makeModel(step('stop', []));

    await expect(runAgentLoop({ model, ...baseInput })).rejects.toThrow(
      /no text content/i,
    );
  });

  it('dispatches a tool_use request to the matching registered tool, appends the tool result, and loops to a final answer', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { rows: [{ id: 1 }] },
    } satisfies ToolOutcome);
    const tools = { runSql: makeTool(execute) };

    const model = makeModel([
      step('tool-calls', [toolCallPart('runSql', { sql: 'SELECT 1' }, 'tool_1')], { inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      step('stop', [textPart('Itt az eredmény.')], { inputTokens: 8, outputTokens: 4, totalTokens: 12 }),
    ]);

    const result = await runAgentLoop({ model, ...baseInput, tools });

    expect(execute).toHaveBeenCalledWith(
      { sql: 'SELECT 1' },
      expect.anything(),
    );
    expect(result.finalText).toBe('Itt az eredmény.');
    // usage accumulates across both rounds (result.totalUsage)
    expect(result.usage).toEqual({ inputTokens: 18, outputTokens: 9 });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      name: 'runSql',
      input: { sql: 'SELECT 1' },
      outcome: { ok: true, data: { rows: [{ id: 1 }] } },
    });
    // transcript: user, assistant(tool-call), tool(tool-result), assistant(text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'tool_1',
          output: { type: 'json', value: { ok: true, data: { rows: [{ id: 1 }] } } },
        },
      ],
    });
  });

  it('feeds a rejected/guard-failed tool outcome back to the model as a normal tool result instead of throwing', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Csak SELECT engedélyezett.',
    } satisfies ToolOutcome);
    const tools = { runSql: makeTool(execute) };

    const model = makeModel([
      step('tool-calls', [
          toolCallPart('runSql', { sql: 'DELETE FROM products' }, 'tool_1'),
        ]),
      step('stop', [textPart('Ezt nem tudom megtenni.')]),
    ]);

    const result = await runAgentLoop({ model, ...baseInput, tools });

    expect(result.finalText).toBe('Ezt nem tudom megtenni.');
    expect(result.toolCalls[0].outcome).toEqual({
      ok: false,
      error: 'Csak SELECT engedélyezett.',
    });
  });

  it('records the real SDK validation error (not a generic placeholder) when the model sends input violating the tool schema', async () => {
    const strictTool = tool({
      description: 'needs a required field',
      inputSchema: z.object({ sql: z.string() }),
      execute: vi.fn(),
    });
    const tools = { runSql: strictTool };

    const model = makeModel([
      // Missing the required `sql` field — rejected by the SDK's own
      // schema validation before `execute` is ever called.
      step('tool-calls', [toolCallPart('runSql', { wrong: 'field' })]),
      step('stop', [textPart('recovered')]),
    ]);

    const result = await runAgentLoop({ model, ...baseInput, tools });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].outcome.ok).toBe(false);
    if (!result.toolCalls[0].outcome.ok) {
      expect(result.toolCalls[0].outcome.error).not.toBe(
        'Tool call did not produce a result.',
      );
      expect(result.toolCalls[0].outcome.error).toMatch(/sql/i);
    }
  });

  it('throws once the max-iteration cap is hit instead of looping forever', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { rows: [] },
    } satisfies ToolOutcome);
    const tools = { runSql: makeTool(execute) };

    // Always asks for the tool again — never reaches a stop finish reason.
    const model = makeModel(async () =>
      step(
        'tool-calls',
        [toolCallPart('runSql', { sql: 'SELECT 1' }, 'tool_x')],
        { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      ),
    );

    await expect(
      runAgentLoop({ model, ...baseInput, tools }),
    ).rejects.toThrow(/max/i);
  });

  it('dispatches a second, refined tool_use call in a later iteration before answering (2 sequential runSql round-trips)', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: { rows: [] },
      } satisfies ToolOutcome)
      .mockResolvedValueOnce({
        ok: true,
        data: { rows: [{ id: 1 }] },
      } satisfies ToolOutcome);
    const tools = { runSql: makeTool(execute) };

    const model = makeModel([
      step('tool-calls', [
          toolCallPart(
            'runSql',
            { sql: "SELECT * FROM products WHERE name = 'nope'" },
            'tool_1',
          ),
        ], { inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      step('tool-calls', [
          toolCallPart(
            'runSql',
            { sql: "SELECT * FROM products WHERE name ILIKE '%nope%'" },
            'tool_2',
          ),
        ], { inputTokens: 11, outputTokens: 6, totalTokens: 17 }),
      step('stop', [textPart('Egy találat van.')], { inputTokens: 8, outputTokens: 4, totalTokens: 12 }),
    ]);

    const result = await runAgentLoop({ model, ...baseInput, tools });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(
      1,
      { sql: "SELECT * FROM products WHERE name = 'nope'" },
      expect.anything(),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      { sql: "SELECT * FROM products WHERE name ILIKE '%nope%'" },
      expect.anything(),
    );
    expect(result.finalText).toBe('Egy találat van.');
    // usage accumulates across all three rounds
    expect(result.usage).toEqual({ inputTokens: 29, outputTokens: 15 });
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]).toEqual({
      name: 'runSql',
      input: { sql: "SELECT * FROM products WHERE name = 'nope'" },
      outcome: { ok: true, data: { rows: [] } },
    });
    expect(result.toolCalls[1]).toEqual({
      name: 'runSql',
      input: { sql: "SELECT * FROM products WHERE name ILIKE '%nope%'" },
      outcome: { ok: true, data: { rows: [{ id: 1 }] } },
    });
  });

  it('dispatches multiple tool_use blocks from a single model response, in order, before looping again', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: { rows: [{ id: 1 }] },
      } satisfies ToolOutcome)
      .mockResolvedValueOnce({
        ok: true,
        data: { rows: [{ id: 2 }] },
      } satisfies ToolOutcome);
    const tools = { runSql: makeTool(execute) };

    const model = makeModel([
      step('tool-calls', [
          toolCallPart(
            'runSql',
            { sql: "SELECT id FROM products WHERE category = 'kaktusz'" },
            'tool_a',
          ),
          toolCallPart(
            'runSql',
            { sql: "SELECT id FROM products WHERE category = 'kerti'" },
            'tool_b',
          ),
        ], { inputTokens: 14, outputTokens: 9, totalTokens: 23 }),
      step('stop', [textPart('Két kategória van.')], { inputTokens: 8, outputTokens: 4, totalTokens: 12 }),
    ]);

    const result = await runAgentLoop({ model, ...baseInput, tools });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(
      1,
      { sql: "SELECT id FROM products WHERE category = 'kaktusz'" },
      expect.anything(),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      { sql: "SELECT id FROM products WHERE category = 'kerti'" },
      expect.anything(),
    );
    expect(result.finalText).toBe('Két kategória van.');
    expect(result.toolCalls).toHaveLength(2);
  });

  it('does not throw when a tool execute call throws — the SDK turns it into a tool error the model can see', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('kaboom'));
    const tools = { runSql: makeTool(execute) };

    const model = makeModel([
      step('tool-calls', [toolCallPart('runSql', { sql: 'SELECT 1' }, 'tool_1')]),
      step('stop', [textPart('done')]),
    ]);

    const result = await runAgentLoop({ model, ...baseInput, tools });

    expect(result.finalText).toBe('done');
  });
});
