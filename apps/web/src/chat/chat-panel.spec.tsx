import { useChat } from '@ai-sdk/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './chat-panel';

// Rendering only (no DOM): the hook's state is fixed per test. Clicking
// (submit, stop) is left for interaction tests with a DOM environment.
vi.mock('@ai-sdk/react', () => ({ useChat: vi.fn() }));

type UseChatResult = ReturnType<typeof useChat>;

function renderWith(state: Partial<UseChatResult>): string {
  vi.mocked(useChat).mockReturnValue({
    messages: [],
    status: 'ready',
    error: undefined,
    sendMessage: vi.fn(),
    stop: vi.fn(),
    ...state,
  } as unknown as UseChatResult);
  return renderToStaticMarkup(<ChatPanel escalatePrefix="[ESCALATE] " />);
}

describe('ChatPanel', () => {
  it('should show an example question when there are no messages yet', () => {
    const html = renderWith({});

    expect(html).toContain('Kérdezz a kínálatról');
    expect(html).toContain('Küldés');
  });

  it('should render the conversation when there are messages', () => {
    const html = renderWith({
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Szia!' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Miben segíthetek?' }],
        },
      ],
    });

    expect(html).toContain('Szia!');
    expect(html).toContain('Miben segíthetek?');
    expect(html).not.toContain('Kérdezz a kínálatról');
  });

  it('should show the thinking indicator when the request is submitted', () => {
    const html = renderWith({ status: 'submitted' });

    expect(html).toContain('Gondolkodom…');
  });

  it('should offer the stop button and lock the input when the answer streams', () => {
    const html = renderWith({ status: 'streaming' });

    expect(html).toContain('Leállítás');
    expect(html).not.toContain('Küldés');
    expect(html).toMatch(/<input[^>]*disabled/);
  });

  it('should show the error as an alert when the request failed', () => {
    const html = renderWith({
      status: 'error',
      error: new Error('Hiba történt a válasz közben.'),
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('Hiba történt a válasz közben.');
  });

  it('should close unfinished Markdown only in the last answer when the answer streams', () => {
    const html = renderWith({
      status: 'streaming',
      messages: [
        {
          id: 'a0',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Régi: **nyitott' }],
        },
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'És még?' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Új: **nyitott' }],
        },
      ],
    });

    expect(html).toContain('Régi: **nyitott');
    expect(html).toContain('Új: <strong>nyitott</strong>');
  });

  it('should leave the last answer untouched when the stream has stopped', () => {
    const html = renderWith({
      status: 'ready',
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Félbe: **nyitott' }],
        },
      ],
    });

    expect(html).toContain('Félbe: **nyitott');
  });
});
