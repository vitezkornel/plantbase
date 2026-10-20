'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createAudioQueue } from './audio-queue';
import { usePushToTalk } from './use-push-to-talk';
import { streamVoiceTurn } from './voice-client';
import type { VoiceEvent } from './voice-events';
import { historyFor, initialVoiceState, voiceReducer } from './voice-state';
import styles from './voice.module.css';
import { WaterfallPanel } from './waterfall-panel';

const FALLBACK_ERROR = 'Hiba történt. Kérlek, próbáld újra.';

export function VoicePanel({ escalatePrefix }: { escalatePrefix: string }) {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const releasedAtRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const queue = useMemo(
    () =>
      createAudioQueue({
        onFirstPlay: () =>
          dispatch({
            type: 'first-sound',
            ms: Math.round(performance.now() - releasedAtRef.current),
          }),
      }),
    [],
  );

  // Warm the filler sentences in the background (best effort).
  useEffect(() => {
    void fetch('/api/voice/warmup', { method: 'POST' }).catch(() => undefined);
  }, []);

  const handleEvent = (event: VoiceEvent): void => {
    if (event.type === 'filler') {
      queue.enqueue(event.audio, 'filler');
    } else if (event.type === 'sentence') {
      queue.enqueue(event.audio, 'sentence');
    }
    dispatch({ type: 'event', event });
  };

  const { isRecording, isSupported, buttonProps } = usePushToTalk({
    onPressStart: () => {
      // Barge-in: silence the speech and stop the request in flight.
      setNotice(null);
      queue.stop();
      abortRef.current?.abort();
      dispatch({ type: 'aborted' });
    },
    onError: setNotice,
    onRecorded: (audio, releasedAt) => {
      releasedAtRef.current = releasedAt;
      const controller = new AbortController();
      abortRef.current = controller;
      const history = historyFor(stateRef.current, escalatePrefix);
      dispatch({ type: 'turn-started' });
      streamVoiceTurn({
        audio,
        history,
        signal: controller.signal,
        onEvent: handleEvent,
      }).catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        dispatch({
          type: 'failed',
          message: error instanceof Error ? error.message : FALLBACK_ERROR,
        });
      });
    },
  });

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.talk}
        data-recording={isRecording}
        disabled={!isSupported}
        aria-pressed={isRecording}
        {...buttonProps}
      >
        {isRecording
          ? 'Hallgatlak…'
          : 'Tartsd nyomva a beszédhez (vagy szóköz)'}
      </button>
      {!isSupported && (
        <p role="alert" className={styles.error}>
          Ez a böngésző nem támogatja a hangfelvételt.
        </p>
      )}
      {notice !== null && (
        <p role="alert" className={styles.error}>
          {notice}
        </p>
      )}
      <div className={styles.turns}>
        {[...state.turns].reverse().map((turn) => (
          <WaterfallPanel key={turn.id} turn={turn} />
        ))}
      </div>
    </div>
  );
}
