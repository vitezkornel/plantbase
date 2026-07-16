import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { AgentTool, ToolOutcome } from '../tools/tool-outcome.js';
import { runAgentLoop } from './agent-loop.js';

function makeClient(response: unknown): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  } as unknown as Anthropic;
}

function makeSequentialClient(responses: unknown[]): Anthropic {
  const create = vi.fn();
  for (const response of responses) {
    create.mockResolvedValueOnce(response);
  }
  return { messages: { create } } as unknown as Anthropic;
}

function makeTool(
  name: string,
  execute: (input: unknown) => Promise<ToolOutcome>,
): AgentTool {
  return {
    definition: {
      name,
      description: 'test tool',
      input_schema: { type: 'object', properties: {} },
    },
    execute,
  };
}

const baseInput = {
  model: 'claude-sonnet-5' as Anthropic.Model,
  maxTokens: 100,
  system: '<role>test</role>',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

describe('runAgentLoop', () => {
  it('returns the final text and token usage for a normal end_turn response', async () => {
    const client = makeClient({
      content: [{ type: 'text', text: 'Hello there!', citations: null }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 7 },
    });

    const result = await runAgentLoop({ client, ...baseInput });

    expect(result.finalText).toBe('Hello there!');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    // Transcript includes the original user message plus the assistant's reply.
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello there!', citations: null }],
    });
  });

  it('joins multiple text blocks with a newline', async () => {
    const client = makeClient({
      content: [
        { type: 'text', text: 'Part one.', citations: null },
        { type: 'text', text: 'Part two.', citations: null },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    const result = await runAgentLoop({ client, ...baseInput });

    expect(result.finalText).toBe('Part one.\nPart two.');
  });

  it('throws when the model asks for a tool but none is registered', async () => {
    const client = makeClient({
      content: [{ type: 'tool_use', id: 'tool_1', name: 'run_sql', input: {} }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 12, output_tokens: 7 },
    });

    await expect(runAgentLoop({ client, ...baseInput })).rejects.toThrow(
      /tool_use/,
    );
  });

  it('throws when the response has no text content', async () => {
    const client = makeClient({
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 0 },
    });

    await expect(runAgentLoop({ client, ...baseInput })).rejects.toThrow(
      /no text content/,
    );
  });

  it('dispatches a tool_use request to the matching registered tool, appends the tool_result, and loops to a final answer', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { rows: [{ id: 1 }] },
    } satisfies ToolOutcome);
    const tool = makeTool('runSql', execute);

    const client = makeSequentialClient([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'runSql',
            input: { sql: 'SELECT 1' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [{ type: 'text', text: 'Itt az eredmény.', citations: null }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 8, output_tokens: 4 },
      },
    ]);

    const result = await runAgentLoop({ client, ...baseInput, tools: [tool] });

    expect(execute).toHaveBeenCalledWith({ sql: 'SELECT 1' });
    expect(result.finalText).toBe('Itt az eredmény.');
    // usage accumulates across both rounds
    expect(result.usage).toEqual({ inputTokens: 18, outputTokens: 9 });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      name: 'runSql',
      input: { sql: 'SELECT 1' },
      outcome: { ok: true, data: { rows: [{ id: 1 }] } },
    });
    // transcript: user, assistant(tool_use), user(tool_result), assistant(text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_1',
          content: JSON.stringify({ rows: [{ id: 1 }] }),
          is_error: false,
        },
      ],
    });
  });

  it('feeds a rejected/guard-failed tool outcome back to the model as an is_error tool_result instead of throwing', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Csak SELECT engedélyezett.',
    } satisfies ToolOutcome);
    const tool = makeTool('runSql', execute);

    const client = makeSequentialClient([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'runSql',
            input: { sql: 'DELETE FROM products' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [
          { type: 'text', text: 'Ezt nem tudom megtenni.', citations: null },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 8, output_tokens: 4 },
      },
    ]);

    const result = await runAgentLoop({ client, ...baseInput, tools: [tool] });

    expect(result.finalText).toBe('Ezt nem tudom megtenni.');
    expect(result.toolCalls[0].outcome).toEqual({
      ok: false,
      error: 'Csak SELECT engedélyezett.',
    });
    const toolResultMessage = result.messages[2] as Anthropic.MessageParam;
    expect(toolResultMessage).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_1',
          content: JSON.stringify({ error: 'Csak SELECT engedélyezett.' }),
          is_error: true,
        },
      ],
    });
  });

  it('throws once the max-iteration cap is hit instead of looping forever', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      data: { rows: [] },
    } satisfies ToolOutcome);
    const tool = makeTool('runSql', execute);

    // Always asks for the tool again — never reaches end_turn.
    const client = makeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool_x',
          name: 'runSql',
          input: { sql: 'SELECT 1' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(
      runAgentLoop({ client, ...baseInput, tools: [tool] }),
    ).rejects.toThrow(/max/i);
  });

  it('throws when the model requests a tool name that is not registered', async () => {
    const tool = makeTool('runSql', vi.fn());
    const client = makeClient({
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'someOtherTool', input: {} },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(
      runAgentLoop({ client, ...baseInput, tools: [tool] }),
    ).rejects.toThrow(/unknown tool/i);
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
    const tool = makeTool('runSql', execute);

    const client = makeSequentialClient([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'runSql',
            input: { sql: "SELECT * FROM products WHERE name = 'nope'" },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        content: [
          {
            type: 'tool_use',
            id: 'tool_2',
            name: 'runSql',
            input: { sql: "SELECT * FROM products WHERE name ILIKE '%nope%'" },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 11, output_tokens: 6 },
      },
      {
        content: [{ type: 'text', text: 'Egy találat van.', citations: null }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 8, output_tokens: 4 },
      },
    ]);

    const result = await runAgentLoop({ client, ...baseInput, tools: [tool] });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, {
      sql: "SELECT * FROM products WHERE name = 'nope'",
    });
    expect(execute).toHaveBeenNthCalledWith(2, {
      sql: "SELECT * FROM products WHERE name ILIKE '%nope%'",
    });
    expect(result.finalText).toBe('Egy találat van.');
    // usage accumulates across all three rounds
    expect(result.usage).toEqual({ inputTokens: 29, outputTokens: 15 });
    // both calls are recorded, in order
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
    // transcript: user, assistant(tool_use #1), user(tool_result #1),
    // assistant(tool_use #2), user(tool_result #2), assistant(text)
    expect(result.messages).toHaveLength(6);
    expect(result.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_1',
          content: JSON.stringify({ rows: [] }),
          is_error: false,
        },
      ],
    });
    expect(result.messages[4]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_2',
          content: JSON.stringify({ rows: [{ id: 1 }] }),
          is_error: false,
        },
      ],
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
    const tool = makeTool('runSql', execute);

    const client = makeSequentialClient([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tool_a',
            name: 'runSql',
            input: {
              sql: "SELECT id FROM products WHERE category = 'kaktusz'",
            },
          },
          {
            type: 'tool_use',
            id: 'tool_b',
            name: 'runSql',
            input: { sql: "SELECT id FROM products WHERE category = 'kerti'" },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 14, output_tokens: 9 },
      },
      {
        content: [
          { type: 'text', text: 'Két kategória van.', citations: null },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 8, output_tokens: 4 },
      },
    ]);

    const result = await runAgentLoop({ client, ...baseInput, tools: [tool] });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, {
      sql: "SELECT id FROM products WHERE category = 'kaktusz'",
    });
    expect(execute).toHaveBeenNthCalledWith(2, {
      sql: "SELECT id FROM products WHERE category = 'kerti'",
    });
    expect(result.finalText).toBe('Két kategória van.');
    expect(result.toolCalls).toHaveLength(2);
    // transcript: user, assistant(2x tool_use), user(2x tool_result), assistant(text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_a',
          content: JSON.stringify({ rows: [{ id: 1 }] }),
          is_error: false,
        },
        {
          type: 'tool_result',
          tool_use_id: 'tool_b',
          content: JSON.stringify({ rows: [{ id: 2 }] }),
          is_error: false,
        },
      ],
    });
  });
});
