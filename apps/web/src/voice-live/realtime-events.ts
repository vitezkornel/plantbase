// The Realtime API's server events as the browser sees them on the data
// channel. A type guard rather than Zod: the events come from OpenAI over our
// own connection (konvenciok.md: own-protocol events), and every accessor
// below re-checks the one field it reads.

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

export function userTranscriptOf(event: RealtimeEvent): string | null {
  return event.type === 'conversation.item.input_audio_transcription.completed'
    ? nonEmptyString(event.transcript)
    : null;
}

export function agentTranscriptOf(event: RealtimeEvent): string | null {
  return event.type === 'response.output_audio_transcript.done'
    ? nonEmptyString(event.transcript)
    : null;
}

/**
 * The first sign of the agent's voice. `output_audio_buffer.started` is the
 * audio itself; the transcript delta is the fallback (spec §4: the exact event
 * name is confirmed in the live check).
 */
export function isAgentAudioStart(event: RealtimeEvent): boolean {
  return (
    event.type === 'output_audio_buffer.started' ||
    event.type === 'response.output_audio_transcript.delta'
  );
}

export interface FunctionCall {
  callId: string;
  name: string;
  rawArguments: string;
}

export function functionCallOf(event: RealtimeEvent): FunctionCall | null {
  if (
    event.type !== 'response.function_call_arguments.done' ||
    typeof event.call_id !== 'string' ||
    typeof event.name !== 'string' ||
    typeof event.arguments !== 'string'
  ) {
    return null;
  }
  return {
    callId: event.call_id,
    name: event.name,
    rawArguments: event.arguments,
  };
}

export function errorCodeOf(event: RealtimeEvent): string | undefined {
  const error = event.error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

export function errorMessageOf(event: RealtimeEvent): string {
  const error = event.error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return 'Ismeretlen hiba.';
}
