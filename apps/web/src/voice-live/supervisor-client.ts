// Client-side handling of the supervisor call: the question is cut to the
// server limit before it is sent, and the response body is checked for shape
// (a non-ok body must become an error output for the model, never an answer).

import { z } from 'zod';
import { MAX_QUESTION_CHARS } from './supervisor-schema';
import type { SupervisorResult } from './tool-dispatch';

const SupervisorResponseSchema = z.object({
  answer: z.string(),
  escalated: z.boolean(),
  serverMs: z.number().nonnegative().optional(),
});

export function parseSupervisorResponse(body: unknown): SupervisorResult {
  const parsed = SupervisorResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('supervisor: unexpected response shape');
  }
  return parsed.data;
}

export function clampQuestion(question: string): string {
  if (question.length <= MAX_QUESTION_CHARS) {
    return question;
  }
  const cut = question.slice(0, MAX_QUESTION_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  // do not leave half of a surrogate pair at the end
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
