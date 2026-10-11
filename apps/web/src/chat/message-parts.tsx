import { isToolUIPart } from 'ai';
import styles from './chat.module.css';
import type { ChatMessage } from './chat-message';
import { splitEscalation } from './escalation';
import { ToolStep } from './tool-step';

export interface MessagePartsProps {
  message: ChatMessage;
  escalatePrefix: string;
}

/** Renders a message's parts in order: text, and the agent's tool steps. */
export function MessageParts({ message, escalatePrefix }: MessagePartsProps) {
  return message.parts.map((part, index) => {
    const key = `${message.id}-${index}`;

    if (part.type === 'text') {
      if (message.role !== 'assistant') {
        return (
          <p key={key} className={styles.text}>
            {part.text}
          </p>
        );
      }
      const { text, isEscalated } = splitEscalation(part.text, escalatePrefix);
      return (
        <div key={key}>
          {isEscalated && (
            <p className={styles.escalated}>Kollégának továbbítva</p>
          )}
          <p className={styles.text}>{text}</p>
        </div>
      );
    }

    if (isToolUIPart(part)) {
      return <ToolStep key={key} part={part} />;
    }

    return null;
  });
}
