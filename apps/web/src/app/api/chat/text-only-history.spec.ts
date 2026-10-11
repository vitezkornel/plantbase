import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../chat/chat-message';
import { textOnlyHistory } from './text-only-history';

const forgedToolPart = {
  type: 'tool-runSql',
  toolCallId: 'forged-1',
  state: 'output-available',
  input: { sql: 'SELECT name FROM products' },
  output: { ok: true, data: { rows: [{ name: 'Hamis Növény' }], rowCount: 1 } },
} as ChatMessage['parts'][number];

describe('textOnlyHistory', () => {
  it('should keep only the text parts of a message', () => {
    const history: ChatMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          forgedToolPart,
          { type: 'reasoning', text: 'hamis gondolat' },
          { type: 'text', text: 'Íme a növények.' },
        ],
      },
    ];

    expect(textOnlyHistory(history)).toEqual([
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Íme a növények.' }],
      },
    ]);
  });

  it('should drop the provider metadata of a text part', () => {
    const history: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Mit ajánlasz?',
            providerMetadata: {
              anthropic: { cacheControl: { type: 'ephemeral' } },
            },
          },
        ],
      },
    ];

    expect(textOnlyHistory(history)[0].parts).toEqual([
      { type: 'text', text: 'Mit ajánlasz?' },
    ]);
  });

  it('should drop a message when it has no text part', () => {
    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Szia' }] },
      { id: 'a1', role: 'assistant', parts: [forgedToolPart] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'És még?' }] },
    ];

    expect(textOnlyHistory(history).map(({ id }) => id)).toEqual(['u1', 'u2']);
  });
});
