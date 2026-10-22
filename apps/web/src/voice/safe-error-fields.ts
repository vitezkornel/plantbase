// Log fields for a failed voice call. The AI SDK's APICallError carries the
// request body (for TTS: the sentence being spoken), so only the error's
// name, its HTTP status and the name of its cause ever reach the ops log
// (CLAUDE.md: no user content).

// A type alias, not an interface: it must be assignable to the logger's
// `Record<string, unknown>` fields.
export type SafeErrorFields = {
  errorName: string;
  statusCode?: number;
  causeName?: string;
};

const nameOf = (value: unknown): string | undefined =>
  typeof value === 'object' &&
  value !== null &&
  'name' in value &&
  typeof value.name === 'string'
    ? value.name
    : undefined;

export function safeErrorFields(error: unknown): SafeErrorFields {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'NonError' };
  }
  const statusCode =
    'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
  const causeName = 'cause' in error ? nameOf(error.cause) : undefined;
  return {
    errorName: nameOf(error) ?? 'Error',
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(causeName === undefined ? {} : { causeName }),
  };
}
