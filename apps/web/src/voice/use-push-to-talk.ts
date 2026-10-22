'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAttemptGuard } from './attempt-guard';
import {
  nextPttPhase,
  type PttEvent,
  type PttPhase,
} from './push-to-talk-machine';
import {
  isEditableTarget,
  isUsableRecording,
  MAX_RECORDING_MS,
  pickRecordingMimeType,
} from './recording-format';

export interface UsePushToTalkOptions {
  /** The button (or space) went down: stop any speech, abort any request. */
  onPressStart: () => void;
  /** A finished recording; `releasedAt` is `performance.now()` at the release. */
  onRecorded: (audio: Blob, releasedAt: number) => void;
  /** The press was too short (or empty) to be a question; nothing was kept. */
  onTooShort: () => void;
  onError: (message: string) => void;
}

export interface PushToTalk {
  isRecording: boolean;
  isSupported: boolean;
  buttonProps: {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onKeyUp: (event: React.KeyboardEvent) => void;
  };
}

const MIC_DENIED = 'A mikrofon használata nincs engedélyezve.';
const NO_RECORDER = 'Ez a böngésző nem támogatja a hangfelvételt.';

const isMimeSupported = (type: string): boolean =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);

export function usePushToTalk(options: UsePushToTalkOptions): PushToTalk {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const phaseRef = useRef<PttPhase>('idle');
  const dispatchRef = useRef<(event: PttEvent) => void>(() => undefined);
  const guardRef = useRef(createAttemptGuard());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const discardRef = useRef(false);
  const startedAtRef = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    setIsSupported(pickRecordingMimeType(isMimeSupported) !== null);
  }, []);

  const failStart = useCallback((message: string) => {
    optionsRef.current.onError(message);
    phaseRef.current = 'idle';
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    const mimeType = pickRecordingMimeType(isMimeSupported);
    if (mimeType === null) {
      failStart(NO_RECORDER);
      return;
    }
    const attempt = guardRef.current.begin();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (guardRef.current.isCurrent(attempt)) {
        failStart(MIC_DENIED);
      }
      return;
    }
    if (!guardRef.current.isCurrent(attempt)) {
      // released (or pressed again) while the permission prompt was open:
      // this attempt is stale, so it must not record, and must not keep the
      // microphone on.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    discardRef.current = false;
    recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (discardRef.current) {
        return;
      }
      const recording = new Blob(chunksRef.current, { type: mimeType });
      const releasedAt = performance.now();
      if (
        isUsableRecording({
          durationMs: releasedAt - startedAtRef.current,
          bytes: recording.size,
        })
      ) {
        optionsRef.current.onRecorded(recording, releasedAt);
      } else {
        optionsRef.current.onTooShort();
      }
    };
    recorder.start();
    startedAtRef.current = performance.now();
    recorderRef.current = recorder;
    timeoutRef.current = setTimeout(
      () => dispatchRef.current('timeout'),
      MAX_RECORDING_MS,
    );
  }, [failStart]);

  const dispatch = useCallback(
    (event: PttEvent) => {
      const { phase, action } = nextPttPhase(phaseRef.current, event);
      phaseRef.current = phase;
      setIsRecording(phase === 'recording');
      if (action === 'start') {
        optionsRef.current.onPressStart();
        void startRecording();
      } else if (action === 'stop' || action === 'discard') {
        guardRef.current.invalidate();
        clearTimeout(timeoutRef.current);
        discardRef.current = action === 'discard';
        const recorder = recorderRef.current;
        recorderRef.current = null;
        if (recorder !== null && recorder.state !== 'inactive') {
          recorder.stop();
        }
      }
    },
    [startRecording],
  );
  dispatchRef.current = dispatch;

  // Space works anywhere on the page except in editable fields.
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (
        event.code !== 'Space' ||
        event.repeat ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      dispatch('press');
    };
    const up = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      dispatch('release');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [dispatch]);

  useEffect(() => () => dispatch('cancel'), [dispatch]);

  return {
    isRecording,
    isSupported,
    buttonProps: {
      onPointerDown: (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatch('press');
      },
      onPointerUp: () => dispatch('release'),
      onPointerCancel: () => dispatch('cancel'),
      // The window listeners handle Space; stop the button's own click-on-space.
      onKeyDown: (event) => {
        if (event.code === 'Space') {
          event.preventDefault();
        }
      },
      onKeyUp: (event) => {
        if (event.code === 'Space') {
          event.preventDefault();
        }
      },
    },
  };
}
