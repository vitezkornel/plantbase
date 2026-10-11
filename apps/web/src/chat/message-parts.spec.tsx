import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './chat-message';
import { MessageParts } from './message-parts';

const ESCALATE_PREFIX = '[ESCALATE] ';

function render(message: ChatMessage): string {
  return renderToStaticMarkup(
    <MessageParts message={message} escalatePrefix={ESCALATE_PREFIX} />,
  );
}

describe('MessageParts', () => {
  it('should render the text of a user message', () => {
    const html = render({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'Mit ajánlasz?' }],
    });

    expect(html).toContain('Mit ajánlasz?');
  });

  it('should show the hand-over badge without the prefix when the answer is escalated', () => {
    const html = render({
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: '[ESCALATE] Egy kollégánk hamarosan jelentkezik.',
        },
      ],
    });

    expect(html).toContain('Kollégának továbbítva');
    expect(html).toContain('Egy kollégánk hamarosan jelentkezik.');
    expect(html).not.toContain('[ESCALATE]');
  });

  it('should not show the badge when the answer is not escalated', () => {
    const html = render({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Egy fikusz.' }],
    });

    expect(html).not.toContain('Kollégának továbbítva');
  });

  it('should render a tool step as a card next to the text', () => {
    const html = render({
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-runSql',
          toolCallId: 't1',
          state: 'input-available',
          input: { sql: 'SELECT 1' },
        },
        { type: 'text', text: 'Kész.' },
      ],
    });

    expect(html).toContain('<details');
    expect(html).toContain('Adatbázis-lekérdezés');
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('Kész.'));
  });

  it('should skip parts it does not display', () => {
    const html = render({
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'belső gondolat' },
      ],
    });

    expect(html).toBe('');
  });
});
