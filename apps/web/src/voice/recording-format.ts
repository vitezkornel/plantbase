/** The client stops recording here; the server checks the same limit. */
export const MAX_RECORDING_MS = 30_000;

// The server accepts webm and mp4; Firefox's default (ogg) is not on the
// transcription model's list, so only these are ever requested.
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export function pickRecordingMimeType(
  isSupported: (type: string) => boolean,
): string | null {
  return PREFERRED_TYPES.find((type) => isSupported(type)) ?? null;
}

/** The space bar must keep typing in fields, only elsewhere it talks. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !('tagName' in target)) {
    return false;
  }
  const { tagName, isContentEditable } = target as {
    tagName: string;
    isContentEditable?: boolean;
  };
  return (
    isContentEditable === true ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  );
}
