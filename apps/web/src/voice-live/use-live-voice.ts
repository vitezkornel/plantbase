'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createLiveSession, type LiveSession } from './live-session';
import { initialLiveState, liveReducer, type LiveState } from './live-state';
import {
  openRealtimeConnection,
  type RealtimeConnection,
} from './realtime-connection';
import { createSendBuffer, type SendBuffer } from './send-buffer';
import type { SilenceMeasurement } from './silence-meter';
import { clampQuestion, parseSupervisorResponse } from './supervisor-client';
import type { SupervisorResult } from './tool-dispatch';

export type VadChoice = 'server' | 'semantic';

const NO_MEASUREMENT: SilenceMeasurement = {
  sinceSpeechStopMs: null,
  sinceToolMs: null,
};

interface SessionResponse {
  clientSecret: string;
  sessionId: string;
  model: string;
  demoOrders: boolean;
}

async function mintSession(vad: VadChoice, filler: boolean): Promise<SessionResponse> {
  const response = await fetch('/api/voice/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vad, filler }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Nem sikerült a kapcsolódás.';
    throw new Error(message);
  }
  return body as SessionResponse;
}

async function callSupervisor(
  sessionId: string,
  question: string,
  signal: AbortSignal,
  transcripts: readonly string[],
): Promise<SupervisorResult> {
  const response = await fetch('/api/voice/supervisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      question: clampQuestion(question),
      ...(transcripts.length === 0 ? {} : { transcripts }),
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`supervisor ${response.status}`);
  }
  return parseSupervisorResponse(await response.json());
}

export function useLiveVoice() {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);
  const [vad, setVadState] = useState<VadChoice>('server');
  const [filler, setFillerState] = useState(true);
  const [running, setRunning] = useState<SilenceMeasurement>(NO_MEASUREMENT);
  const stateRef = useRef<LiveState>(state);
  stateRef.current = state;
  const connectionRef = useRef<RealtimeConnection | null>(null);
  const outboxRef = useRef<SendBuffer | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const attemptRef = useRef(0);

  const teardown = useCallback(() => {
    attemptRef.current += 1; // invalidates a connect() still in flight
    sessionRef.current?.dispose();
    sessionRef.current = null;
    outboxRef.current?.close();
    outboxRef.current = null;
    connectionRef.current?.close();
    connectionRef.current = null;
    setRunning(NO_MEASUREMENT);
  }, []);

  const disconnect = useCallback(() => {
    teardown();
    dispatch({ type: 'disconnected' });
  }, [teardown]);

  const connectWith = useCallback(
    async (nextVad: VadChoice, nextFiller: boolean) => {
      teardown();
      const attempt = attemptRef.current;
      dispatch({ type: 'connecting' });
      try {
        const minted = await mintSession(nextVad, nextFiller);
        if (attempt !== attemptRef.current) {
          return;
        }
        // The session may send (the history seed) before openRealtimeConnection
        // has returned the connection: the outbox holds those events.
        const outbox = createSendBuffer();
        outboxRef.current = outbox;
        const session = createLiveSession({
          sessionId: minted.sessionId,
          filler: nextFiller,
          demoOrders: minted.demoOrders,
          send: outbox.send,
          fetchSupervisor: (question, signal, said) =>
            callSupervisor(minted.sessionId, question, signal, said),
          emit: dispatch,
          onAutoDisconnect: (reason) => {
            dispatch({
              type: 'log',
              kind: 'info',
              text:
                reason === 'idle'
                  ? 'Automatikus bontás: 5 perc tétlenség.'
                  : 'Automatikus bontás: elérte a 20 perces plafont.',
            });
            disconnect();
          },
          initialTurns: stateRef.current.turns,
        });
        sessionRef.current = session;
        const connection = await openRealtimeConnection({
          clientSecret: minted.clientSecret,
          model: minted.model,
          onEvent: session.onEvent,
          onOpen: session.onOpen,
          onClose: () => {
            if (sessionRef.current === session) {
              disconnect();
            }
          },
        });
        if (attempt !== attemptRef.current) {
          connection.close();
          return;
        }
        connectionRef.current = connection;
        outbox.attach(connection.send);
        dispatch({ type: 'connected', model: minted.model, demoOrders: minted.demoOrders });
      } catch (error: unknown) {
        if (attempt !== attemptRef.current) {
          return;
        }
        teardown();
        dispatch({
          type: 'failed',
          message: error instanceof Error ? error.message : 'Nem sikerült a kapcsolódás.',
        });
      }
    },
    [disconnect, teardown],
  );

  const connect = useCallback(() => {
    void connectWith(vad, filler);
  }, [connectWith, vad, filler]);

  // Both switches change the (fixed, server-side) session configuration, so a
  // live connection is re-opened; the transcript is re-seeded into it.
  const setVad = useCallback(
    (next: VadChoice) => {
      setVadState(next);
      if (stateRef.current.status === 'connected') {
        void connectWith(next, filler);
      }
    },
    [connectWith, filler],
  );
  const setFiller = useCallback(
    (next: boolean) => {
      setFillerState(next);
      if (stateRef.current.status === 'connected') {
        void connectWith(vad, next);
      }
    },
    [connectWith, vad],
  );

  // Live silence counters.
  useEffect(() => {
    if (state.status !== 'connected') {
      return undefined;
    }
    const handle = setInterval(() => {
      setRunning(sessionRef.current?.running() ?? NO_MEASUREMENT);
    }, 100);
    return () => clearInterval(handle);
  }, [state.status]);

  // Leaving the page closes the connection, the microphone and every timer.
  useEffect(() => {
    const onPageHide = (): void => teardown();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      teardown();
    };
  }, [teardown]);

  return { state, vad, filler, running, connect, disconnect, setVad, setFiller };
}
