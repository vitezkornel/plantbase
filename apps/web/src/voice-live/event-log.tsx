import type { LogLine } from './live-state';
import styles from './voice-live.module.css';

export function EventLog({ lines }: { lines: readonly LogLine[] }) {
  if (lines.length === 0) {
    return <p className={styles.empty}>Még nincs esemény.</p>;
  }
  return (
    <ol className={styles.log} aria-label="Eseménylog">
      {lines.map((line) => (
        <li key={line.id} data-kind={line.kind}>
          {line.demo ? <span className={styles.demo}>DEMO</span> : null}
          {line.text}
        </li>
      ))}
    </ol>
  );
}
