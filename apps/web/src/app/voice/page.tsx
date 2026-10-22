import { ESCALATE_PREFIX } from 'core';
import Link from 'next/link';
import { VoicePanel } from '../../voice/voice-panel';
import styles from '../page.module.css';

export default function VoicePage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Plantbase hang</h1>
        <p>
          Tartsd nyomva a gombot (vagy a szóközt), és kérdezz magyarul.{' '}
          <Link href="/">Vissza a szöveges chatre</Link>
        </p>
      </header>
      <VoicePanel escalatePrefix={ESCALATE_PREFIX} />
    </main>
  );
}
