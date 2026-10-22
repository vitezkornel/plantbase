import type { VoiceEvent } from './voice-events';
import {
  MAX_HISTORY_MESSAGE_CHARS,
  type HistoryMessage,
} from './voice-request-schema';

export type TurnStatus =
  | 'transcribing'
  | 'answering'
  | 'done'
  | 'error'
  | 'aborted';

/** Filled step by step as the events arrive; null = not reached yet. */
export interface ServerTiming {
  sttMs: number | null;
  firstTokenMs: number | null;
  firstSentenceMs: number | null;
  totalMs: number | null;
}

const noTiming: ServerTiming = {
  sttMs: null,
  firstTokenMs: null,
  firstSentenceMs: null,
  totalMs: null,
};

export interface VoiceTurn {
  id: number;
  status: TurnStatus;
  transcript: string | null;
  /** The answer as shown: without the escalation prefix. */
  text: string;
  tools: string[];
  isEscalated: boolean;
  /** Sentences of the answer that could not be read aloud. */
  failedSentences: number;
  server: ServerTiming | null;
  /** Release of the button → first audible output (client-side). */
  firstSoundMs: number | null;
  error: string | null;
}

export interface VoiceState {
  turns: VoiceTurn[];
}

export type VoiceAction =
  | { type: 'turn-started' }
  | { type: 'event'; event: VoiceEvent }
  | { type: 'first-sound'; ms: number }
  | { type: 'aborted' }
  | { type: 'failed'; message: string };

export const initialVoiceState: VoiceState = { turns: [] };

const MAX_HISTORY_MESSAGES = 20;

export function lastTurn(state: VoiceState): VoiceTurn | undefined {
  return state.turns.at(-1);
}

export function voiceReducer(
  state: VoiceState,
  action: VoiceAction,
): VoiceState {
  if (action.type === 'turn-started') {
    const turn: VoiceTurn = {
      id: state.turns.length,
      status: 'transcribing',
      transcript: null,
      text: '',
      tools: [],
      isEscalated: false,
      failedSentences: 0,
      server: null,
      firstSoundMs: null,
      error: null,
    };
    return { turns: [...state.turns, turn] };
  }
  const current = lastTurn(state);
  if (current === undefined) {
    return state;
  }
  return { turns: [...state.turns.slice(0, -1), reduceTurn(current, action)] };
}

function reduceTurn(turn: VoiceTurn, action: VoiceAction): VoiceTurn {
  switch (action.type) {
    case 'first-sound':
      return turn.firstSoundMs === null
        ? { ...turn, firstSoundMs: action.ms }
        : turn;
    case 'aborted':
      return isInProgress(turn) ? { ...turn, status: 'aborted' } : turn;
    case 'failed':
      return { ...turn, status: 'error', error: action.message };
    case 'event':
      return reduceEvent(turn, action.event);
    default:
      return turn;
  }
}

function reduceEvent(turn: VoiceTurn, event: VoiceEvent): VoiceTurn {
  switch (event.type) {
    case 'transcript':
      return {
        ...turn,
        transcript: event.text,
        status: 'answering',
        server: { ...(turn.server ?? noTiming), sttMs: event.sttMs },
      };
    case 'first-token':
      return {
        ...turn,
        server: { ...(turn.server ?? noTiming), firstTokenMs: event.ms },
      };
    case 'speech-failed':
      return { ...turn, failedSentences: turn.failedSentences + 1 };
    case 'tool':
      return { ...turn, tools: [...turn.tools, event.name] };
    case 'text-delta':
      return { ...turn, text: turn.text + event.text };
    case 'escalated':
      return { ...turn, isEscalated: true };
    case 'timing':
      return {
        ...turn,
        server: {
          sttMs: event.sttMs,
          firstTokenMs: event.firstTokenMs,
          firstSentenceMs: event.firstSentenceMs,
          totalMs: event.totalMs,
        },
      };
    case 'done':
      return { ...turn, status: 'done' };
    case 'error':
      return { ...turn, status: 'error', error: event.message };
    default:
      return turn; // filler, sentence: audio only, handled by the audio queue
  }
}

const isInProgress = (turn: VoiceTurn): boolean =>
  turn.status === 'transcribing' || turn.status === 'answering';

/** Finished turns as conversation history, the model's own wording preserved. */
export function historyFor(
  state: VoiceState,
  escalatePrefix: string,
): HistoryMessage[] {
  const messages = state.turns.flatMap((turn): HistoryMessage[] => {
    if (turn.status !== 'done' || turn.transcript === null || turn.text === '') {
      return [];
    }
    // One long answer must not make the server reject every later turn.
    const cut = (text: string): string =>
      text.slice(0, MAX_HISTORY_MESSAGE_CHARS);
    return [
      { role: 'user', content: cut(turn.transcript) },
      {
        role: 'assistant',
        content: cut((turn.isEscalated ? escalatePrefix : '') + turn.text),
      },
    ];
  });
  return messages.slice(-MAX_HISTORY_MESSAGES);
}
