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
    approxTranscript: string | undefined,
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
  let lastUserTranscript: string | undefined;
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

  const sendCreate = (event: object, source: 'nudge' | 'answer'): void => {
    createInFlight = true;
    lastCreate = source;
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
    fetchSupervisor: (question, signal) =>
      deps.fetchSupervisor(question, signal, lastUserTranscript),
    send: (event) => {
      if ('type' in event && event.type === 'response.create') {
        if (busy()) {
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
        createInFlight = false;
        clearRetry();
        idle.touch();
        nudge.cancel();
        dispatcher.interrupt();
        return;
      case 'input_audio_buffer.speech_stopped':
        log('end-of-turn', 'Beszéd vége (end-of-turn)');
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
          log('question', `Kérdés a supervisornak: ${question}`);
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
      lastUserTranscript = userText.slice(0, 500);
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
