import { readFile, rm } from 'node:fs/promises';
import { MockLanguageModelV2 } from 'ai/test';
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

const usage = { inputTokens: 20, outputTokens: 8, totalTokens: 28 };

function textPart(text: string) {
  return { type: 'text' as const, text };
}

function toolCallPart(toolName: string, input: unknown, toolCallId = 'tool_1') {
  return {
    type: 'tool-call' as const,
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  };
}

function makeModel(text: string) {
  return new MockLanguageModelV2({
    doGenerate: { finishReason: 'stop', usage, warnings: [], content: [textPart(text)] },
  });
}

/** Simulates one runSql tool round-trip before the model's final answer. */
function makeToolUsingModel(sql: string, finalText: string) {
  return new MockLanguageModelV2({
    doGenerate: [
      {
        finishReason: 'tool-calls',
        usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 },
        warnings: [],
        content: [toolCallPart('runSql', { sql })],
      },
      {
        finishReason: 'stop',
        usage: { inputTokens: 15, outputTokens: 6, totalTokens: 21 },
        warnings: [],
        content: [textPart(finalText)],
      },
    ],
  });
}

/** Simulates one listCategories tool round-trip before the model's final answer. */
function makeListCategoriesUsingModel(finalText: string) {
  return new MockLanguageModelV2({
    doGenerate: [
      {
        finishReason: 'tool-calls',
        usage: { inputTokens: 25, outputTokens: 10, totalTokens: 35 },
        warnings: [],
        content: [toolCallPart('listCategories', {})],
      },
      {
        finishReason: 'stop',
        usage: { inputTokens: 15, outputTokens: 6, totalTokens: 21 },
        warnings: [],
        content: [textPart(finalText)],
      },
    ],
  });
}

describe('askAgent', () => {
  it('rejects an empty question without calling the model', async () => {
    const model = makeModel('unused');

    await expect(askAgent('', { model })).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('returns the model answer, the system prompt, the message array, and usage', async () => {
    const model = makeModel('Budapest a fővárosa.');

    const result = await askAgent('Mi Magyarország fővárosa?', { model });

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
    const model = makeModel('Ez egy teszt válasz.');

    const result = await askAgent('teszt kérdés', { model });

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
    const model = makeToolUsingModel(
      'SELECT id, name FROM products LIMIT 5',
      'Íme néhány növény.',
    );

    const result = await askAgent('mit ajánlasz?', { model });

    expect(result.answer).toBe('Íme néhány növény.');
    // transcript: user, assistant(tool-call), tool(tool-result), assistant(text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool-call', toolName: 'runSql' }],
    });
    expect(result.messages[2]).toMatchObject({
      role: 'tool',
      content: [{ type: 'tool-result', output: { type: 'json' } }],
    });

    await rm(result.logPath, { force: true });
  });

  it('dispatches a listCategories tool_use round-trip and answers from the (mocked) DB result', async () => {
    const model = makeListCategoriesUsingModel('Ezek a kategóriáink.');

    const result = await askAgent('milyen kategóriák vannak?', { model });

    expect(result.answer).toBe('Ezek a kategóriáink.');
    expect(result.messages).toHaveLength(4);
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool-call', toolName: 'listCategories' }],
    });
    expect(result.messages[2]).toMatchObject({
      role: 'tool',
      content: [{ type: 'tool-result', output: { type: 'json' } }],
    });

    await rm(result.logPath, { force: true });
  });

  it('logs the generated SQL and its result alongside the existing fields', async () => {
    const model = makeToolUsingModel(
      'SELECT id, name FROM products WHERE pet_safe = true LIMIT 5',
      'Íme néhány háziállat-barát növény.',
    );

    const result = await askAgent('milyen növény háziállat-barát?', { model });

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
    const model = makeModel(
      '[ESCALATE] Ebben nem tudok segíteni, de egy kollégánk hamarosan jelentkezik.',
    );

    const result = await askAgent('Hol van a rendelésem?', { model });

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
    const model = makeModel('Budapest a fővárosa.');

    const result = await askAgent('Mi Magyarország fővárosa?', { model });

    expect(result.escalated).toBe(false);

    await rm(result.logPath, { force: true });
  });
});
