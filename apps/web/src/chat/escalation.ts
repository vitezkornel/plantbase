export interface EscalationView {
  /** The answer text with the escalation prefix removed. */
  text: string;
  /** True if the agent handed the question off to a human colleague. */
  isEscalated: boolean;
}

/**
 * Splits the ask-agent's `[ESCALATE] ` marker off an (possibly still
 * streaming) answer. The prefix itself comes from the server (core's
 * `ESCALATE_PREFIX`), so it is never duplicated here.
 */
export function splitEscalation(text: string, prefix: string): EscalationView {
  if (text.startsWith(prefix)) {
    return { text: text.slice(prefix.length), isEscalated: true };
  }
  // Mid-stream the answer may so far be only part of the prefix — show
  // nothing yet rather than flashing "[ESCA" at the user.
  if (prefix.startsWith(text)) {
    return { text: '', isEscalated: false };
  }
  return { text, isEscalated: false };
}
