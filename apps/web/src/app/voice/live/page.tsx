import Link from 'next/link';
import { LivePanel } from '../../../voice-live/live-panel';
import styles from '../../page.module.css';

export default function VoiceLivePage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Plantbase hang — élő (realtime)</h1>
        <p>
          Kapcsolódás után szabadon beszélhetsz magyarul.{' '}
          <Link href="/voice">Vissza a nyomva-tartós hangra</Link>
        </p>
      </header>
      <LivePanel />
    </main>
  );
}
