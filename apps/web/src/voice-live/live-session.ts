// Everything the live page does with the data-channel events, without React
// or WebRTC: it takes server events in, and sends client events / emits UI
// actions out. That keeps the interplay (barge-in vs a pending tool call, the
// nudge, the two silence measurements, the idle cut-off) unit-testable.

import { buildHistorySeed, type TranscriptTurn } from './history-seed';
import { createIdleTimer } from './idle-timer';
import type { LiveAction } from './live-state';
import {
  createProgressNudge,
  PROGRESS_NUDGE_INSTRUCTIONS,
} from './progress-nudge';
import {
  agentTranscriptOf,
  errorCodeOf,
  errorMessageOf,
  functionCallOf,
  isAgentAudioStart,
  userTranscriptOf,
  type RealtimeEvent,
} from './realtime-events';
import { ASK_PLANTBASE_TOOL_NAME } from './realtime-tools';
import { createSilenceMeter, type SilenceMeasurement } from './silence-meter';
import {
  createToolDispatcher,
  parseQuestion,
  type DispatchInfo,
  type SupervisorResult,
} from './tool-dispatch';

export interface LiveSessionDeps {
  sessionId: string;
  filler: boolean;
  demoOrders: boolean;
  send(event: object): void;
  fetchSupervisor(
    question: string,
    signal: AbortSignal,
    transcripts: readonly string[],
  ): Promise<SupervisorResult>;
  emit(action: LiveAction): void;
  onAutoDisconnect(reason: 'idle' | 'max-duration'): void;
  initialTurns: readonly TranscriptTurn[];
  now?: () => number;
}

export interface LiveSession {
  onOpen(): void;
  onEvent(event: RealtimeEvent): void;
  /** Running values for the live silence counters. */
  running(): SilenceMeasurement;
  dispose(): void;
}

// How long to wait before re-sending an answer the API refused as concurrent
// when no response.done is known to be coming.
const ANSWER_RETRY_MS = 400;

// Mirrors supervisor-schema.ts (count and length of the transcripts sent).
const MAX_TRANSCRIPTS = 6;
const MAX_TRANSCRIPT_CHARS = 500;
const TRANSCRIPT_WAIT_MS = 1500;

// The on-screen log shows the supervisor's answer briefly (text stays on the
// user's screen; nothing here reaches the operational log).
const BRIEF_ANSWER_CHARS = 200;
const brief = (text: string): string =>
  text.length <= BRIEF_ANSWER_CHARS
    ? text
    : `${text.slice(0, BRIEF_ANSWER_CHARS)}…`;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export function createLiveSession(deps: LiveSessionDeps): LiveSession {
  const now = deps.now ?? Date.now;
  const meter = createSilenceMeter();
  let disposed = false;
  let responding = false;
  let toolPending = false;
  // The user's last approximate transcripts (oldest first) go to the
  // supervisor; the transcript of the turn that just ended can lag behind the
  // tool call, so a call waits for it a moment.
  const transcripts: string[] = [];
  let transcriptPending = false;
  const transcriptWaiters = new Set<() => void>();
  const awaitTranscript = (signal: AbortSignal): Promise<void> => {
    if (!transcriptPending) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        transcriptPending = false; // none is coming: later calls do not wait
        wake();
      }, TRANSCRIPT_WAIT_MS);
      function release(): void {
        clearTimeout(timer);
        transcriptWaiters.delete(wake);
        signal.removeEventListener('abort', onAbort);
      }
      function wake(): void {
        release();
        resolve();
      }
      function onAbort(): void {
        release();
        reject(new Error('aborted'));
      }
      transcriptWaiters.add(wake);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };
  // A tool result's response.create that arrived while a response was still
  // active: the API refuses a second concurrent response, so it waits for
  // response.done (and is dropped if the user starts talking first).
  let responseHeld = false;
  // A response.create we sent whose response.created has not arrived yet: the
  // API still counts the conversation as busy, so it gates new creates too.
  let createInFlight = false;
  let lastCreate: 'nudge' | 'answer' | null = null;
  let retryHandle: ReturnType<typeof setTimeout> | undefined;
  const busy = (): boolean => responding || createInFlight;

  let heldSince: number | null = null;
  const sendCreate = (event: object, source: 'nudge' | 'answer'): void => {
    createInFlight = true;
    lastCreate = source;
    if (source === 'answer') {
      log(
        'timing',
        heldSince === null
          ? 'Részidő: eredmény elküldve a modellnek'
          : `Részidő: eredmény elküldve a modellnek (tartva ${seconds(now() - heldSince)})`,
      );
      heldSince = null;
    }
    deps.send(event);
  };
  const clearRetry = (): void => {
    clearTimeout(retryHandle);
    retryHandle = undefined;
  };
  const releaseHeld = (): void => {
    if (responseHeld && !busy()) {
      responseHeld = false;
      sendCreate({ type: 'response.create' }, 'answer');
    }
  };

  const log = (
    kind: Extract<LiveAction, { type: 'log' }>['kind'],
    text: string,
    demo = false,
  ): void => {
    deps.emit({ type: 'log', kind, text, demo });
  };

  const idle = createIdleTimer({
    onIdle: () => {
      dispose();
      deps.onAutoDisconnect('idle');
    },
    onMaxDuration: () => {
      dispose();
      deps.onAutoDisconnect('max-duration');
    },
  });

  const nudge = createProgressNudge({
    onNudge: () => {
      if (busy()) {
        return; // a concurrent response.create would be refused
      }
      log('filler', 'Progresszív frissítés kérve (5 s)');
      sendCreate(
        {
          type: 'response.create',
          response: { instructions: PROGRESS_NUDGE_INSTRUCTIONS },
        },
        'nudge',
      );
    },
  });

  const onSettled = (info: DispatchInfo): void => {
    toolPending = false;
    nudge.cancel();
    if (info.outcome === 'stale') {
      log(
        'stale',
        `${info.name}: elavult, eldobva (${seconds(info.ms)})`,
        info.demo,
      );
      return;
    }
    if (info.outcome === 'failed') {
      log('supervisor', `${info.name}: hiba (${seconds(info.ms)})`, info.demo);
      return;
    }
    log('supervisor', `${info.name}: válasz ${seconds(info.ms)}`, info.demo);
    if (info.answer !== undefined) {
      log('answer', `Supervisor válasza: ${brief(info.answer)}`, info.demo);
    }
    deps.emit({ type: 'new-answer' });
    if (info.escalated) {
      deps.emit({ type: 'escalated' });
    }
  };

  const dispatcher = createToolDispatcher({
    fetchSupervisor: (question, signal) => {
      const begun = now();
      const ask = (): Promise<SupervisorResult> => {
        const requested = now();
        const said = [...transcripts];
        const mainQuestion = said.at(-1);
        log(
          'supervisor-question',
          `Supervisor fő kérdése (átirat): ${mainQuestion ?? 'nincs átirat, a recepciós megfogalmazása megy'}`,
        );
        return deps
          .fetchSupervisor(question, signal, said)
          .then((fetched) => {
            const result: SupervisorResult = {
              ...fetched,
              ...(mainQuestion === undefined ? {} : { userQuestion: mainQuestion }),
            };
            if (!signal.aborted) {
              // Where the time between the tool call and the answer went.
              if (requested > begun) {
                log('timing', `Részidő: átirat-várakozás ${seconds(requested - begun)}`);
              }
              const fetched = now() - requested;
              log('timing', `Részidő: supervisor-kérés (fetch) ${seconds(fetched)}`);
              if (result.serverMs !== undefined) {
                log(
                  'timing',
                  `Részidő: ebből a szerver ${seconds(result.serverMs)}, a többi (hálózat, route-indulás) ${seconds(Math.max(0, fetched - result.serverMs))}`,
                );
              }
            }
            return result;
          });
      };
      // No pending transcript: ask at once, without an extra tick.
      return transcriptPending
        ? awaitTranscript(signal).then(ask)
        : ask();
    },
    send: (event) => {
      if ('type' in event && event.type === 'response.create') {
        if (busy()) {
          if (!responseHeld) {
            log('timing', 'Részidő: eredmény tartva, a modell még beszél');
            heldSince = now();
          }
          responseHeld = true;
          return;
        }
        sendCreate(event, 'answer');
        return;
      }
      deps.send(event);
    },
    demoOrders: deps.demoOrders,
    now,
    onSettled,
  });

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    idle.stop();
    nudge.cancel();
    clearRetry();
    dispatcher.dispose();
  }

  const onEvent = (event: RealtimeEvent): void => {
    if (disposed) {
      return;
    }
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        log(
          responding ? 'barge-in' : 'speech',
          responding ? 'Közbevágás (barge-in)' : 'Beszéd kezdete',
        );
        meter.speechStarted();
        responseHeld = false;
        heldSince = null;
        createInFlight = false;
        clearRetry();
        idle.touch();
        nudge.cancel();
        dispatcher.interrupt();
        return;
      case 'input_audio_buffer.speech_stopped':
        log('end-of-turn', 'Beszéd vége (end-of-turn)');
        transcriptPending = true;
        meter.speechStopped(now());
        return;
      case 'response.created':
        responding = true;
        createInFlight = false;
        idle.touch();
        return;
      case 'response.done':
        responding = false;
        createInFlight = false;
        releaseHeld();
        return;
      case 'conversation.item.truncated':
        log('truncated', 'Az előzmény levágva (truncation)');
        return;
      case 'error':
        log('error', errorMessageOf(event));
        // The create we just sent was refused or failed: it will not produce
        // a response.created, so it must not keep the conversation "busy".
        createInFlight = false;
        if (
          errorCodeOf(event) === 'conversation_already_has_active_response' &&
          lastCreate === 'answer'
        ) {
          // The tool result must never be lost: send it again once the
          // active response is done, or shortly if no done is coming.
          responseHeld = true;
          if (!responding) {
            clearRetry();
            retryHandle = setTimeout(() => {
              retryHandle = undefined;
              if (!disposed) {
                releaseHeld();
              }
            }, ANSWER_RETRY_MS);
          }
        }
        return;
      default:
        break;
    }

    const call = functionCallOf(event);
    if (call !== null) {
      toolPending = true;
      meter.toolCalled(now());
      log(
        'tool',
        `Tool-hívás: ${call.name}`,
        call.name !== ASK_PLANTBASE_TOOL_NAME,
      );
      if (call.name === ASK_PLANTBASE_TOOL_NAME) {
        const question = parseQuestion(call.rawArguments);
        if (question !== null) {
          log('question', `Recepciós megfogalmazása: ${question}`);
        }
      }
      if (deps.filler && call.name === ASK_PLANTBASE_TOOL_NAME) {
        nudge.start();
      }
      dispatcher.handle(call);
      return;
    }

    if (isAgentAudioStart(event)) {
      const measurement = meter.agentAudio(now());
      if (
        measurement.sinceSpeechStopMs !== null ||
        measurement.sinceToolMs !== null
      ) {
        deps.emit({ type: 'silence', measurement });
        const parts: string[] = [];
        if (measurement.sinceSpeechStopMs !== null) {
          parts.push(`beszédvégtől ${seconds(measurement.sinceSpeechStopMs)}`);
        }
        if (measurement.sinceToolMs !== null) {
          parts.push(`tool-hívástól ${seconds(measurement.sinceToolMs)}`);
        }
        log('silence', `Csend: ${parts.join(', ')}`);
      }
      return;
    }

    const userText = userTranscriptOf(event);
    if (userText !== null) {
      transcripts.push(userText.slice(0, MAX_TRANSCRIPT_CHARS));
      transcripts.splice(0, Math.max(0, transcripts.length - MAX_TRANSCRIPTS));
      transcriptPending = false;
      for (const wake of [...transcriptWaiters]) {
        wake();
      }
      log('user', `TE (közelítő): ${userText}`);
      deps.emit({
        type: 'turn',
        turn: { role: 'user', text: userText, approximate: true },
      });
      return;
    }

    const agentText = agentTranscriptOf(event);
    if (agentText !== null) {
      if (toolPending) {
        log('filler', `Filler: ${agentText}`);
      } else {
        log('assistant', `Asszisztens: ${agentText}`);
      }
      deps.emit({
        type: 'turn',
        turn: { role: 'assistant', text: agentText, approximate: false },
      });
    }
  };

  return {
    onOpen: () => {
      if (disposed) {
        return;
      }
      for (const item of buildHistorySeed(deps.initialTurns)) {
        deps.send(item);
      }
    },
    onEvent,
    running: () => meter.running(now()),
    dispose,
  };
}
