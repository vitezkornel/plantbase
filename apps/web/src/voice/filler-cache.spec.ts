import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFillerCache,
  getFillerIfReady,
  warmFillers,
} from './filler-cache';
import {
  ALL_FILLER_TEXTS,
  fillerTextForTool,
  STILL_SEARCHING_TEXT,
} from './filler-texts';

beforeEach(() => {
  clearFillerCache();
});

describe('fillerTextForTool', () => {
  it.each([
    ['runSql', 'Megnézem a katalógusban…'],
    ['searchKnowledge', 'Utánanézek a gondozási tudástárban…'],
    ['listCategories', 'Megnézem, milyen kategóriáink vannak…'],
    ['customerPreferences', 'Egy pillanat…'],
  ])('should have the agreed filler for %s', (tool, text) => {
    expect(fillerTextForTool(tool)).toBe(text);
  });

  it('should have no filler for an unknown tool', () => {
    expect(fillerTextForTool('ingestProduct')).toBeUndefined();
  });

  it('should include the 5-second refresh in the warm-up list', () => {
    expect(ALL_FILLER_TEXTS).toContain(STILL_SEARCHING_TEXT);
  });
});

describe('filler cache', () => {
  const synthesize = vi.fn(async (text: string) =>
    new TextEncoder().encode(text),
  );
  const onFailure = vi.fn();

  beforeEach(() => {
    synthesize.mockClear();
    onFailure.mockClear();
  });

  it('should not have a filler before the warm-up finished', () => {
    void warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });

    expect(
      getFillerIfReady({ model: 'm', voice: 'v', text: 'Egy pillanat…' }),
    ).toBeUndefined();
  });

  it('should serve a warmed filler without waiting', async () => {
    await warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });

    const audio = getFillerIfReady({
      model: 'm',
      voice: 'v',
      text: 'Egy pillanat…',
    });

    expect(audio && new TextDecoder().decode(audio)).toBe('Egy pillanat…');
  });

  it('should key the cache by model and voice, so a changed voice never plays the old file', async () => {
    await warmFillers({ model: 'm', voice: 'coral', synthesize, onFailure });

    expect(
      getFillerIfReady({ model: 'm', voice: 'alloy', text: 'Egy pillanat…' }),
    ).toBeUndefined();
    expect(
      getFillerIfReady({ model: 'm2', voice: 'coral', text: 'Egy pillanat…' }),
    ).toBeUndefined();
  });

  it('should synthesize each filler once, however many times it is warmed', async () => {
    await warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });
    await warmFillers({ model: 'm', voice: 'v', synthesize, onFailure });

    expect(synthesize).toHaveBeenCalledTimes(ALL_FILLER_TEXTS.length);
  });

  it('should report a failed filler and keep going without it', async () => {
    const failing = vi.fn(async (text: string) => {
      if (text === 'Egy pillanat…') {
        throw new Error('tts down');
      }
      return new Uint8Array([1]);
    });

    await warmFillers({
      model: 'm',
      voice: 'v',
      synthesize: failing,
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(
      getFillerIfReady({ model: 'm', voice: 'v', text: 'Egy pillanat…' }),
    ).toBeUndefined();
    expect(
      getFillerIfReady({ model: 'm', voice: 'v', text: STILL_SEARCHING_TEXT }),
    ).toBeDefined();
  });
});
