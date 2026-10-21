import { describe, expect, it } from 'vitest';
import {
  isEditableTarget,
  isUsableRecording,
  MIN_RECORDING_MS,
  pickRecordingMimeType,
} from './recording-format';

describe('pickRecordingMimeType', () => {
  it('should prefer webm/opus', () => {
    expect(pickRecordingMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('should fall back to mp4 (Safari)', () => {
    expect(pickRecordingMimeType((type) => type === 'audio/mp4')).toBe(
      'audio/mp4',
    );
  });

  it('should return null when nothing the server accepts is supported', () => {
    expect(pickRecordingMimeType(() => false)).toBeNull();
  });
});

describe('isEditableTarget', () => {
  const target = (tagName: string, isContentEditable = false) =>
    ({ tagName, isContentEditable }) as unknown as EventTarget;

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])(
    'should treat <%s> as editable',
    (tagName) => {
      expect(isEditableTarget(target(tagName))).toBe(true);
    },
  );

  it('should treat contenteditable as editable', () => {
    expect(isEditableTarget(target('DIV', true))).toBe(true);
  });

  it('should not treat a button or a missing target as editable', () => {
    expect(isEditableTarget(target('BUTTON'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('isUsableRecording', () => {
  it('should reject a tap that is shorter than the minimum', () => {
    expect(isUsableRecording({ durationMs: MIN_RECORDING_MS - 1, bytes: 5000 })).toBe(false);
  });

  it('should accept a recording of the minimum length', () => {
    expect(isUsableRecording({ durationMs: MIN_RECORDING_MS, bytes: 5000 })).toBe(true);
  });

  it('should reject an empty recording however long it ran', () => {
    expect(isUsableRecording({ durationMs: 2000, bytes: 0 })).toBe(false);
  });
});
