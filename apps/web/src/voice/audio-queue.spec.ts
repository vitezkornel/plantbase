import { describe, expect, it, vi } from 'vitest';
import { createAudioQueue, type PlayableAudio } from './audio-queue';

class FakeAudio implements PlayableAudio {
  onended: PlayableAudio['onended'] = null;
  onerror: PlayableAudio['onerror'] = null;
  paused = false;
  constructor(readonly src: string) {}
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  finish(): void {
    this.onended?.(new Event('ended'));
  }
}

function setup() {
  const created: FakeAudio[] = [];
  const onFirstPlay = vi.fn();
  const onIdle = vi.fn();
  const queue = createAudioQueue({
    createAudio: (src) => {
      const audio = new FakeAudio(src);
      created.push(audio);
      return audio;
    },
    onFirstPlay,
    onIdle,
  });
  return { queue, created, onFirstPlay, onIdle };
}

const sources = (created: FakeAudio[]) => created.map((a) => a.src);

describe('createAudioQueue', () => {
  it('should play items one after the other', () => {
    const { queue, created } = setup();

    queue.enqueue('A', 'sentence');
    queue.enqueue('B', 'sentence');

    expect(sources(created)).toEqual(['data:audio/mpeg;base64,A']);
    created[0]?.finish();
    expect(sources(created)).toEqual([
      'data:audio/mpeg;base64,A',
      'data:audio/mpeg;base64,B',
    ]);
  });

  it('should report the first playback of a turn once', () => {
    const { queue, created, onFirstPlay } = setup();

    queue.enqueue('A', 'filler');
    created[0]?.finish();
    queue.enqueue('B', 'sentence');

    expect(onFirstPlay).toHaveBeenCalledTimes(1);
    expect(onFirstPlay).toHaveBeenCalledWith('filler');
  });

  it('should drop a waiting filler once a sentence arrived', () => {
    const { queue, created } = setup();

    queue.enqueue('S0', 'sentence');
    queue.enqueue('F', 'filler');
    created[0]?.finish();

    expect(created).toHaveLength(1);
  });

  it('should ignore a filler that arrives after a sentence', () => {
    const { queue, created } = setup();

    queue.enqueue('S0', 'sentence');
    created[0]?.finish();
    queue.enqueue('F', 'filler');

    expect(created).toHaveLength(1);
  });

  it('should not cut off a filler that is already playing when a sentence arrives', () => {
    const { queue, created } = setup();

    queue.enqueue('F', 'filler');
    queue.enqueue('S0', 'sentence');

    expect(created[0]?.paused).toBe(false);
    created[0]?.finish();
    expect(sources(created)).toEqual([
      'data:audio/mpeg;base64,F',
      'data:audio/mpeg;base64,S0',
    ]);
  });

  it('should stop the current audio, empty the queue and forget the turn on stop()', () => {
    const { queue, created, onFirstPlay } = setup();

    queue.enqueue('A', 'sentence');
    queue.enqueue('B', 'sentence');
    queue.stop();
    created[0]?.finish(); // a late ended event must not start B

    expect(created[0]?.paused).toBe(true);
    expect(created).toHaveLength(1);

    queue.enqueue('C', 'filler');
    expect(created).toHaveLength(2);
    expect(onFirstPlay).toHaveBeenCalledTimes(2);
  });

  it('should call onIdle when the queue runs dry', () => {
    const { queue, created, onIdle } = setup();

    queue.enqueue('A', 'sentence');
    created[0]?.finish();

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('should move on when playback is rejected (autoplay policy)', async () => {
    const created: FakeAudio[] = [];
    const queue = createAudioQueue({
      createAudio: (src) => {
        const audio = new FakeAudio(src);
        audio.play = () => Promise.reject(new Error('NotAllowedError'));
        created.push(audio);
        return audio;
      },
    });

    queue.enqueue('A', 'sentence');
    queue.enqueue('B', 'sentence');
    await Promise.resolve();
    await Promise.resolve();

    expect(created).toHaveLength(2);
  });
});
