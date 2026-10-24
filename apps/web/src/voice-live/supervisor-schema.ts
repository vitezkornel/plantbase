import { z } from 'zod';

export const MAX_QUESTION_CHARS = 500;
export const MAX_TRANSCRIPT_CHARS = 500;
export const MAX_TRANSCRIPTS = 6;

// The realtime model fills this in, so it is untrusted input like any other
// tool argument: strict keys, bounded text, a known-shaped session id.
export const SupervisorRequestSchema = z.strictObject({
  sessionId: z.uuid(),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  // The user's last approximate transcripts, oldest first (see
  // supervisor-messages.ts). Text only, bounded in count and length.
  transcripts: z
    .array(z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS))
    .max(MAX_TRANSCRIPTS)
    .optional(),
});

export type SupervisorRequest = z.infer<typeof SupervisorRequestSchema>;
