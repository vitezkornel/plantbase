import type { TranscriptTurn } from './history-seed';
import type { SilenceMeasurement } from './silence-meter';

export const MAX_LOG_LINES = 200;

export type LogKind =
  | 'speech'
  | 'barge-in'
  | 'end-of-turn'
  | 'truncated'
  | 'tool'
  | 'filler'
  | 'supervisor'
  | 'silence'
  | 'stale'
  | 'error'
  | 'info';

export interface LogLine {
  id: number;
  kind: LogKind;
  text: string;
  /** True for lines about the DEMO order tool. */
  demo: boolean;
}

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface LiveState {
  status: LiveStatus;
  error: string | null;
  model: string | null;
  demoOrders: boolean;
  lines: LogLine[];
  /** The transcript lives here (client memory) — it is re-seeded on reconnect. */
  turns: TranscriptTurn[];
  escalated: boolean;
  lastSilence: SilenceMeasurement | null;
}

export const initialLiveState: LiveState = {
  status: 'idle',
  error: null,
  model: null,
  demoOrders: false,
  lines: [],
  turns: [],
  escalated: false,
  lastSilence: null,
};

export type LiveAction =
  | { type: 'connecting' }
  | { type: 'connected'; model: string; demoOrders: boolean }
  | { type: 'disconnected' }
  | { type: 'failed'; message: string }
  | { type: 'log'; kind: LogKind; text: string; demo?: boolean }
  | { type: 'turn'; turn: TranscriptTurn }
  | { type: 'escalated' }
  | { type: 'new-answer' }
  | { type: 'silence'; measurement: SilenceMeasurement };

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'connecting':
      return { ...state, status: 'connecting', error: null };
    case 'connected':
      return {
        ...state,
        status: 'connected',
        error: null,
        model: action.model,
        demoOrders: action.demoOrders,
      };
    case 'disconnected':
      return { ...state, status: 'idle' };
    case 'failed':
      return { ...state, status: 'error', error: action.message };
    case 'log': {
      const id = (state.lines.at(-1)?.id ?? 0) + 1;
      const line: LogLine = {
        id,
        kind: action.kind,
        text: action.text,
        demo: action.demo ?? false,
      };
      return { ...state, lines: [...state.lines, line].slice(-MAX_LOG_LINES) };
    }
    case 'turn':
      return { ...state, turns: [...state.turns, action.turn] };
    case 'escalated':
      return { ...state, escalated: true };
    case 'new-answer':
      return { ...state, escalated: false };
    case 'silence':
      return { ...state, lastSilence: action.measurement };
  }
}
