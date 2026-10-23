// Session ≠ thread: the transcript stays with us (client memory). When the
// connection is re-opened (VAD or filler switch), the last few turns are put
// back as plain conversation items — data, never instructions. The
// instructions themselves stay the fixed server constant.

export const SEED_MAX_TURNS = 6;
export const SEED_MAX_CHARS = 1500;
export const APPROXIMATE_MARK = '(közelítő átirat) ';

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  /** True for the realtime side-transcription of the user (an approximation). */
  approximate: boolean;
}

const textOf = (turn: TranscriptTurn): string =>
  turn.approximate ? `${APPROXIMATE_MARK}${turn.text}` : turn.text;

export function buildHistorySeed(turns: readonly TranscriptTurn[]): object[] {
  const recent = turns.slice(-SEED_MAX_TURNS);
  const kept: Array<{ role: TranscriptTurn['role']; text: string }> = [];
  let budget = SEED_MAX_CHARS;

  for (const turn of [...recent].reverse()) {
    const text = textOf(turn);
    if (text.length <= budget) {
      kept.unshift({ role: turn.role, text });
      budget -= text.length;
    } else {
      if (kept.length === 0) {
        kept.unshift({ role: turn.role, text: text.slice(0, budget) });
      }
      break;
    }
  }

  return kept.map(({ role, text }) => ({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role,
      content: [
        { type: role === 'user' ? 'input_text' : 'output_text', text },
      ],
    },
  }));
}
