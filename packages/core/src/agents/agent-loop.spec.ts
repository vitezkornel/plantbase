import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from './agent-loop.js';

function makeClient(response: unknown): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  } as unknown as Anthropic;
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
});
