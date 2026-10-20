import { ESCALATE_PREFIX } from 'core';
import Link from 'next/link';
import { ChatPanel } from '../chat/chat-panel';
import styles from './page.module.css';

export default function Page() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Plantbase</h1>
        <p>
          Kérdezz a növénykatalógusról — az asszisztens a valódi kínálatból
          válaszol.{' '}
          <Link href="/voice">Beszélj hozzá hangosan →</Link>
        </p>
      </header>
      <ChatPanel escalatePrefix={ESCALATE_PREFIX} />
    </main>
  );
}
