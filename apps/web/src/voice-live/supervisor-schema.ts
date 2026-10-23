import { z } from 'zod';

export const MAX_QUESTION_CHARS = 500;
export const MAX_APPROX_TRANSCRIPT_CHARS = 500;

// The realtime model fills this in, so it is untrusted input like any other
// tool argument: strict keys, bounded text, a known-shaped session id.
export const SupervisorRequestSchema = z.strictObject({
  sessionId: z.uuid(),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  approxTranscript: z.string().max(MAX_APPROX_TRANSCRIPT_CHARS).optional(),
});

export type SupervisorRequest = z.infer<typeof SupervisorRequestSchema>;
