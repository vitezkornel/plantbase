// Log fields for a failed voice call. The AI SDK's APICallError carries the
// request body (for TTS: the sentence being spoken), so only the error's
// name and HTTP status ever reach the ops log (CLAUDE.md: no user content).

export interface SafeErrorFields {
  errorName: string;
  statusCode?: number;
}

export function safeErrorFields(error: unknown): SafeErrorFields {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'NonError' };
  }
  const name =
    'name' in error && typeof error.name === 'string' ? error.name : 'Error';
  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
  return statusCode === undefined
    ? { errorName: name }
    : { errorName: name, statusCode };
}
