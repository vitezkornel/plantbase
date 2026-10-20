// One spoken turn: speech → text → ask-agent (voice mode) → sentences →
// speech, reported as VoiceEvents. No HTTP here (voice-handler.ts owns
// that), so the whole pipeline is testable with mocked models.

import { ESCALATE_PREFIX, logger, streamAskAgent } from 'core';
import { splitEscalation } from '../chat/escalation';
import { getFillerIfReady } from './filler-cache';
import { fillerTextForTool, STILL_SEARCHING_TEXT } from './filler-texts';
import {
  createSentenceSplitter,
  createSpokenBudget,
  stripMarkdown,
} from './spoken-text';
import { createSpeechQueue } from './speech-queue';
import { synthesizeSpeech } from './synthesize-speech';
import { transcribeAudio } from './transcribe-audio';
import type { VoiceEvent } from './voice-events';
import type { VoiceDeps } from './voice-providers';
import type { HistoryMessage } from './voice-request-schema';

export const STILL_SEARCHING_DELAY_MS = 5000;
export const EMPTY_TRANSCRIPT_MESSAGE = 'Nem hallottam semmit, próbáld újra.';
export const GENERIC_ERROR_MESSAGE =
  'Hiba történt a hangos válasz közben. Kérlek, próbáld újra.';

export interface RunVoiceTurnInput {
  deps: VoiceDeps;
  audio: Uint8Array;
  history: HistoryMessage[];
  signal: AbortSignal;
  emit: (event: VoiceEvent) => void;
  now?: () => number;
}

const toBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64');

/** Rejects on failure (the handler maps it to an `error` event). */
export async function runVoiceTurn({
  deps,
  audio,
  history,
  signal,
  emit,
  now = () => performance.now(),
}: RunVoiceTurnInput): Promise<void> {
  const { config } = deps;
  const startedAt = now();
  const elapsed = (): number => Math.round(now() - startedAt);

  const transcript = await transcribeAudio({
    model: deps.transcriptionModel,
    modelId: config.sttModel,
    audio,
    signal,
  });
  const sttMs = elapsed();
  logger.info('api_voice.stt_done', { sttMs });

  if (transcript.text.trim() === '') {
    emit({ type: 'error', message: EMPTY_TRANSCRIPT_MESSAGE });
    return;
  }
  emit({ type: 'transcript', text: transcript.text, sttMs });

  let firstTokenMs: number | null = null;
  let firstSentenceMs: number | null = null;
  let hasText = false;
  let hasFillerPlayed = false;
  let isEscalatedSent = false;
  let rawText = '';
  let shownLength = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  const synthesize = (text: string): Promise<Uint8Array> =>
    synthesizeSpeech({
      model: deps.speechModel,
      voice: config.voice,
      text,
      signal,
    });

  const queue = createSpeechQueue({
    synthesize,
    onSentence: (sentence) => {
      if (firstSentenceMs === null) {
        firstSentenceMs = elapsed();
        logger.info('api_voice.first_sentence', { firstSentenceMs });
      }
      emit({
        type: 'sentence',
        index: sentence.index,
        text: sentence.text,
        audio: toBase64(sentence.audio),
        ttsMs: sentence.ttsMs,
      });
    },
    now,
  });

  const splitter = createSentenceSplitter();
  const budget = createSpokenBudget();
  const speak = (sentence: string): void => {
    const clean = stripMarkdown(sentence);
    const spoken = clean === '' ? null : budget.take(clean);
    if (spoken !== null) {
      queue.enqueue(spoken);
    }
  };

  const playFiller = (text: string): void => {
    if (hasText || firstSentenceMs !== null) {
      return; // the answer itself has started; a filler would only delay it
    }
    const filler = getFillerIfReady({
      model: config.ttsModel,
      voice: config.voice,
      text,
    });
    if (filler !== undefined) {
      emit({ type: 'filler', text, audio: toBase64(filler) });
    }
  };

  try {
    const result = streamAskAgent(
      [...history, { role: 'user', content: transcript.text }],
      { mode: 'voice', abortSignal: signal, model: deps.askModel },
    );

    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        emit({ type: 'tool', name: part.toolName });
        const text = fillerTextForTool(part.toolName);
        if (text !== undefined && !hasFillerPlayed) {
          hasFillerPlayed = true;
          playFiller(text);
          refreshTimer = setTimeout(
            () => playFiller(STILL_SEARCHING_TEXT),
            STILL_SEARCHING_DELAY_MS,
          );
        }
      } else if (part.type === 'text-delta') {
        hasText = true;
        clearTimeout(refreshTimer);
        if (firstTokenMs === null) {
          firstTokenMs = elapsed();
          logger.info('api_voice.first_token', { firstTokenMs });
        }
        rawText += part.text;
        const view = splitEscalation(rawText, ESCALATE_PREFIX);
        if (view.isEscalated && !isEscalatedSent) {
          isEscalatedSent = true;
          emit({ type: 'escalated' });
        }
        const delta = view.text.slice(shownLength);
        shownLength = view.text.length;
        if (delta !== '') {
          emit({ type: 'text-delta', text: delta });
          splitter.push(delta).forEach(speak);
        }
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
    // ai@5 ends the stream normally when the signal fires (an `abort` part,
    // no throw), so the abort is turned into a rejection here.
    signal.throwIfAborted();
    splitter.flush().forEach(speak);
    await queue.finish();
  } finally {
    clearTimeout(refreshTimer);
  }

  const totalMs = elapsed();
  logger.info('api_voice.completed', { totalMs });
  emit({ type: 'timing', sttMs, firstTokenMs, firstSentenceMs, totalMs });
  emit({ type: 'done' });
}
