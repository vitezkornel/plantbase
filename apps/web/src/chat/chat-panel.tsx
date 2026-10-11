'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, type FormEvent } from 'react';
import styles from './chat.module.css';
import type { ChatMessage } from './chat-message';
import { MessageParts } from './message-parts';

export interface ChatPanelProps {
  /** core's ESCALATE_PREFIX, handed down by the server component. */
  escalatePrefix: string;
}

export function ChatPanel({ escalatePrefix }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, stop, error } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const isBusy = status === 'submitted' || status === 'streaming';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (text === '' || isBusy) {
      return;
    }
    void sendMessage({ text });
    setInput('');
  }

  return (
    <section className={styles.panel}>
      <ol className={styles.messages} aria-live="polite">
        {messages.length === 0 && (
          <li className={styles.empty}>
            Kérdezz a kínálatról, pl. „Milyen kezdőbarát, háziállat-biztos
            szobanövényt ajánlasz?”
          </li>
        )}
        {messages.map((message) => (
          <li
            key={message.id}
            className={message.role === 'user' ? styles.user : styles.assistant}
          >
            <MessageParts message={message} escalatePrefix={escalatePrefix} />
          </li>
        ))}
        {status === 'submitted' && (
          <li className={styles.thinking}>Gondolkodom…</li>
        )}
      </ol>

      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Írd be a kérdésed…"
          aria-label="Kérdés"
          disabled={isBusy}
        />
        {isBusy ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => void stop()}
          >
            Leállítás
          </button>
        ) : (
          <button
            type="submit"
            className={styles.button}
            disabled={input.trim() === ''}
          >
            Küldés
          </button>
        )}
      </form>
    </section>
  );
}
