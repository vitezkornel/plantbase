import styles from './chat.module.css';
import {
  describeToolStep,
  type ToolPartLike,
  type ToolStepStatus,
} from './tool-step-view';

const STATUS_TEXT: Record<ToolStepStatus, string> = {
  running: 'fut…',
  done: 'kész',
  failed: 'hiba',
};

export interface ToolStepProps {
  part: ToolPartLike;
}

/** One tool call of the agent, collapsed by default: input → result. */
export function ToolStep({ part }: ToolStepProps) {
  const view = describeToolStep(part);

  return (
    <details className={`${styles.toolStep} ${styles[view.status]}`}>
      <summary>
        <span className={styles.toolLabel}>{view.label}</span>
        <span className={styles.toolStatus}>{STATUS_TEXT[view.status]}</span>
      </summary>
      <div className={styles.toolBody}>
        <p className={styles.toolHeading}>Bemenet</p>
        <pre>{formatInput(view.input)}</pre>
        {view.status === 'done' && (
          <>
            <p className={styles.toolHeading}>Eredmény</p>
            <pre>{JSON.stringify(view.data, null, 2)}</pre>
          </>
        )}
        {view.status === 'failed' && (
          <p className={styles.toolError}>{view.error}</p>
        )}
      </div>
    </details>
  );
}

/** Shows a runSql query as plain SQL; anything else as JSON. */
function formatInput(input: unknown): string {
  if (
    typeof input === 'object' &&
    input !== null &&
    'sql' in input &&
    typeof input.sql === 'string'
  ) {
    return input.sql;
  }
  return JSON.stringify(input ?? {}, null, 2);
}
