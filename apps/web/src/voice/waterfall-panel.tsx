import { timingTone } from './timing-thresholds';
import type { VoiceTurn } from './voice-state';
import styles from './voice.module.css';

interface Metric {
  key: 'stt' | 'first-token' | 'first-sound' | 'total';
  label: string;
  ms: number | null;
}

function metricsOf(turn: VoiceTurn): Metric[] {
  return [
    { key: 'stt', label: 'STT', ms: turn.server?.sttMs ?? null },
    {
      key: 'first-token',
      label: 'Első token',
      ms: turn.server?.firstTokenMs ?? null,
    },
    { key: 'first-sound', label: 'Első hang', ms: turn.firstSoundMs },
    { key: 'total', label: 'Összesen', ms: turn.server?.totalMs ?? null },
  ];
}

export function WaterfallPanel({ turn }: { turn: VoiceTurn }) {
  const metrics = metricsOf(turn);
  const longest = Math.max(1500, ...metrics.map((m) => m.ms ?? 0));

  return (
    <section className={styles.turn} aria-label="Fordulat">
      <p className={styles.transcript}>{turn.transcript ?? '…'}</p>
      <ul className={styles.metrics}>
        {metrics.map(({ key, label, ms }) => (
          <li
            key={key}
            className={styles.metric}
            data-metric={key}
            data-tone={ms === null ? 'pending' : timingTone(ms)}
          >
            <span className={styles.metricLabel}>{label}</span>
            <span className={styles.bar}>
              <span
                className={styles.barFill}
                style={{
                  width:
                    ms === null
                      ? '0%'
                      : `${Math.min(100, (ms / longest) * 100)}%`,
                }}
              />
            </span>
            <span className={styles.metricValue}>
              {ms === null ? '—' : `${ms} ms`}
            </span>
          </li>
        ))}
      </ul>
      {turn.tools.length > 0 && (
        <p className={styles.tools}>Eszközök: {turn.tools.join(', ')}</p>
      )}
      {turn.isEscalated && (
        <p className={styles.escalated}>Kollégának továbbítva</p>
      )}
      {turn.text !== '' && <p className={styles.answer}>{turn.text}</p>}
      {turn.error !== null && (
        <p role="alert" className={styles.error}>
          {turn.error}
        </p>
      )}
    </section>
  );
}
