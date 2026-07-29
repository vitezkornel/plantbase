import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { generateHydePassage } from './hyde-generate.js';

function makeClient(text: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text, citations: null }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  } as unknown as Anthropic;
}

describe('generateHydePassage', () => {
  it('returns the model-generated hypothetical passage text', async () => {
    const client = makeClient(
      'Meyer lemon trees thrive in full sun and well-drained soil.',
    );

    const result = await generateHydePassage('Hogyan gondozzak egy Meyer citromfát?', {
      client,
    });

    expect(result).toBe(
      'Meyer lemon trees thrive in full sun and well-drained soil.',
    );
  });

  it('sends the Hungarian query as the user message', async () => {
    const client = makeClient('some passage');

    await generateHydePassage('Hogyan gondozzak egy Meyer citromfát?', {
      client,
    });

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'Hogyan gondozzak egy Meyer citromfát?' },
        ],
      }),
    );
  });

  it('throws when the response has no text content', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    } as unknown as Anthropic;

    await expect(
      generateHydePassage('kérdés', { client }),
    ).rejects.toThrow();
  });
});
