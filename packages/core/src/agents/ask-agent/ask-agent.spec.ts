import type Anthropic from '@anthropic-ai/sdk';
import { readFile, rm } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { askAgent } from './ask-agent.js';
import { ASK_AGENT_SYSTEM_PROMPT } from './ask-agent-prompt.js';

// This is a fast unit-test file: only the DB round-trip is mocked here
// (readonly-db-client.js) so `askAgent` still exercises its own real
// runSql-tool wiring (Zod schema + guard) end to end. The live-DB proof
// that the guard AND the DB role both hold lives in
// tools/run-sql/run-sql-tool.spec.ts's integration tests instead.
vi.mock('../../tools/readonly-db-client.js', () => ({
  runReadonlyQuery: vi.fn().mockResolvedValue({
    rows: [{ id: 1, name: 'Teszt Növény' }],
    rowCount: 1,
  }),
  closeReadonlyPool: vi.fn(),
}));

function makeClient(text: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text, citations: null }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    },
  } as unknown as Anthropic;
}

/** Simulates one runSql tool round-trip before the model's final answer. */
function makeToolUsingClient(sql: string, finalText: string): Anthropic {
  const create = vi
    .fn()
    .mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'runSql', input: { sql } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 30, output_tokens: 12 },
    })
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: finalText, citations: null }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 15, output_tokens: 6 },
    });
  return { messages: { create } } as unknown as Anthropic;
}

/** Simulates one listCategories tool round-trip before the model's final answer. */
function makeListCategoriesUsingClient(finalText: string): Anthropic {
  const create = vi
    .fn()
    .mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'listCategories', input: {} },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 25, output_tokens: 10 },
    })
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: finalText, citations: null }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 15, output_tokens: 6 },
    });
  return { messages: { create } } as unknown as Anthropic;
}

describe('askAgent', () => {
  it('rejects an empty question without calling the model', async () => {
    const client = makeClient('unused');

    await expect(askAgent('', { client })).rejects.toThrow();
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('returns the model answer, the system prompt, the message array, and usage', async () => {
    const client = makeClient('Budapest a fővárosa.');

    const result = await askAgent('Mi Magyarország fővárosa?', { client });

    expect(result.answer).toBe('Budapest a fővárosa.');
    expect(result.system).toBe(ASK_AGENT_SYSTEM_PROMPT);
    expect(result.messages[0]).toEqual({
      role: 'user',
      content: 'Mi Magyarország fővárosa?',
    });
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 8 });

    await rm(result.logPath, { force: true });
  });

  it('writes a JSONL log entry with system prompt, messages, response, and usage', async () => {
    const client = makeClient('Ez egy teszt válasz.');

    const result = await askAgent('teszt kérdés', { client });

    const raw = await readFile(result.logPath, 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.system).toBe(ASK_AGENT_SYSTEM_PROMPT);
    expect(entry.response).toBe('Ez egy teszt válasz.');
    expect(entry.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(Array.isArray(entry.messages)).toBe(true);
    expect(entry.messages[0]).toEqual({
      role: 'user',
      content: 'teszt kérdés',
    });
    expect(typeof entry.timestamp).toBe('string');
    expect(entry.sqlCalls).toEqual([]);

    await rm(result.logPath, { force: true });
  });

  it('dispatches a runSql tool_use round-trip and answers from the (mocked) DB result', async () => {
    const client = makeToolUsingClient(
      'SELECT id, name FROM products LIMIT 5',
      'Íme néhány növény.',
    );

    const result = await askAgent('mit ajánlasz?', { client });

    expect(result.answer).toBe('Íme néhány növény.');
    // transcript: user, assistant(tool_use), user(tool_result), assistant(text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'runSql' }],
    });
    expect(result.messages[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', is_error: false }],
    });

    await rm(result.logPath, { force: true });
  });

  it('dispatches a listCategories tool_use round-trip and answers from the (mocked) DB result', async () => {
    const client = makeListCategoriesUsingClient('Ezek a kategóriáink.');

    const result = await askAgent('milyen kategóriák vannak?', { client });

    expect(result.answer).toBe('Ezek a kategóriáink.');
    expect(result.messages).toHaveLength(4);
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'listCategories' }],
    });
    expect(result.messages[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', is_error: false }],
    });

    await rm(result.logPath, { force: true });
  });

  it('logs the generated SQL and its result alongside the existing fields', async () => {
    const client = makeToolUsingClient(
      'SELECT id, name FROM products WHERE pet_safe = true LIMIT 5',
      'Íme néhány háziállat-barát növény.',
    );

    const result = await askAgent('milyen növény háziállat-barát?', { client });

    const raw = await readFile(result.logPath, 'utf-8');
    const entry = JSON.parse(raw.trim().split('\n')[0]);

    expect(entry.sqlCalls).toHaveLength(1);
    expect(entry.sqlCalls[0].sql).toBe(
      'SELECT id, name FROM products WHERE pet_safe = true LIMIT 5',
    );
    expect(entry.sqlCalls[0].result).toEqual({
      ok: true,
      data: { rows: [{ id: 1, name: 'Teszt Növény' }], rowCount: 1 },
    });

    await rm(result.logPath, { force: true });
  });

  it('strips the [ESCALATE] prefix and sets escalated=true', async () => {
    const client = makeClient(
      '[ESCALATE] Ebben nem tudok segíteni, de egy kollégánk hamarosan jelentkezik.',
    );

    const result = await askAgent('Hol van a rendelésem?', { client });

    expect(result.answer).toBe(
      'Ebben nem tudok segíteni, de egy kollégánk hamarosan jelentkezik.',
    );
    expect(result.escalated).toBe(true);

    const raw = await readFile(result.logPath, 'utf-8');
    const entry = JSON.parse(raw.trim().split('\n')[0]);
    expect(entry.escalated).toBe(true);

    await rm(result.logPath, { force: true });
  });

  it('sets escalated=false for a normal (non-escalated) answer', async () => {
    const client = makeClient('Budapest a fővárosa.');

    const result = await askAgent('Mi Magyarország fővárosa?', { client });

    expect(result.escalated).toBe(false);

    await rm(result.logPath, { force: true });
  });
});
