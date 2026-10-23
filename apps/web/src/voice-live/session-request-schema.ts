import { z } from 'zod';

// Enum and boolean only — there is deliberately no free-text field, so a
// client can never influence the realtime instructions.
export const SessionRequestSchema = z.strictObject({
  vad: z.enum(['server', 'semantic']),
  filler: z.boolean(),
});

export type SessionRequest = z.infer<typeof SessionRequestSchema>;
