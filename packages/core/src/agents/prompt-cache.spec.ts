import { MockLanguageModelV2, simulateReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { runAgentLoop } from './agent-loop.js';
import { streamAskAgent } from './ask-agent/ask-agent-stream.js';
import { cachedSystemMessage } from './prompt-cache.js';

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

describe('cachedSystemMessage', () => {
  it('should be a system message with an ephemeral Anthropic cache breakpoint', () => {
    expect(cachedSystemMessage('<role>x</role>')).toEqual({
      role: 'system',
      content: '<role>x</role>',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
  });
});

describe('prompt caching in the model call', () => {
  it('should mark the system prompt (and with it the tool definitions before it) in the streaming ask-agent', async () => {
    const model = new MockLanguageModelV2({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'ok' },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: 'stop', usage },
          ],
        }),
      },
    });
    let logPath = '';
    const result = streamAskAgent([{ role: 'user', content: 'k' }], {
      model,
      onLogWritten: (p) => (logPath = p),
    });
    await result.text;
    const { rm } = await import('node:fs/promises');
    await import('vitest').then(({ vi }) => vi.waitFor(() => expect(logPath).not.toBe('')));
    await rm(logPath, { force: true });

    const first = model.doStreamCalls[0]?.prompt[0];
    expect(first?.role).toBe('system');
    expect(first?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
    expect(model.doStreamCalls[0]?.prompt.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('should mark the system prompt in the agent loop too', async () => {
    const model = new MockLanguageModelV2({
      doGenerate: {
        content: [{ type: 'text', text: 'ok' }],
        finishReason: 'stop',
        usage,
        warnings: [],
      },
    });

    await runAgentLoop({
      model,
      maxTokens: 100,
      system: '<role>test</role>',
      messages: [{ role: 'user', content: 'k' }],
      tools: {},
    });

    const first = model.doGenerateCalls[0]?.prompt[0];
    expect(first?.role).toBe('system');
    expect(first?.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });
});
