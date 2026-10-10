import { ESCALATE_PREFIX } from 'core';
import { ChatPanel } from '../chat/chat-panel';
import styles from './page.module.css';

export default function Page() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Plantbase</h1>
        <p>
          Kérdezz a növénykatalógusról — az asszisztens a valódi kínálatból
          válaszol.
        </p>
      </header>
      <ChatPanel escalatePrefix={ESCALATE_PREFIX} />
    </main>
  );
}
