import { describe, expect, it } from 'vitest';
import { isEditableTarget, pickRecordingMimeType } from './recording-format';

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
