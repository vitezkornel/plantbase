import type Anthropic from '@anthropic-ai/sdk';
import { readFile, rm } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { askAgent } from './ask-agent.js';
import { ASK_AGENT_SYSTEM_PROMPT } from './ask-agent-prompt.js';

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

    await rm(result.logPath, { force: true });
  });
});
