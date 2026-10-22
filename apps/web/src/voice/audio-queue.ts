// Plays the answer's mp3 pieces one after the other. A filler is only for
// bridging silence, so it never plays once a sentence of the answer exists.

export interface PlayableAudio {
  // Shaped like HTMLAudioElement's own handler properties, so a real
  // <audio> is assignable.
  onended: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event | string) => unknown) | null;
  play(): Promise<void>;
  pause(): void;
}

export type AudioKind = 'filler' | 'sentence';

export interface AudioQueueOptions {
  createAudio?: (src: string) => PlayableAudio;
  /** The first audible output of a turn (a filler counts). */
  onFirstPlay?: (kind: AudioKind) => void;
  onIdle?: () => void;
}

export interface AudioQueue {
  enqueue(audioBase64: string, kind: AudioKind): void;
  /** Barge-in: silences at once and forgets the turn. */
  stop(): void;
}

interface Item {
  src: string;
  kind: AudioKind;
}

export function createAudioQueue({
  createAudio = (src) => new Audio(src),
  onFirstPlay,
  onIdle,
}: AudioQueueOptions = {}): AudioQueue {
  let pending: Item[] = [];
  let current: PlayableAudio | null = null;
  let hasSentence = false;
  let hasPlayed = false;
  let generation = 0;

  const playNext = (): void => {
    if (current !== null) {
      return;
    }
    const item = pending.shift();
    if (item === undefined) {
      onIdle?.();
      return;
    }
    const audio = createAudio(item.src);
    const myGeneration = generation;
    current = audio;
    const advance = (): void => {
      if (generation !== myGeneration || current !== audio) {
        return; // a stop() happened; this audio belongs to a dead turn
      }
      current = null;
      playNext();
    };
    audio.onended = advance;
    audio.onerror = advance;
    if (!hasPlayed) {
      hasPlayed = true;
      onFirstPlay?.(item.kind);
    }
    audio.play().catch(advance);
  };

  return {
    enqueue(audioBase64, kind) {
      if (kind === 'filler' && hasSentence) {
        return;
      }
      if (kind === 'sentence') {
        hasSentence = true;
        pending = pending.filter((item) => item.kind === 'sentence');
      }
      pending.push({ src: `data:audio/mpeg;base64,${audioBase64}`, kind });
      playNext();
    },
    stop() {
      generation += 1;
      pending = [];
      hasSentence = false;
      hasPlayed = false;
      const audio = current;
      current = null;
      audio?.pause();
    },
  };
}
