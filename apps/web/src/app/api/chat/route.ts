import 'server-only';
import {
  convertToModelMessages,
  TypeValidationError,
  validateUIMessages,
} from 'ai';
import { ASK_AGENT_TOOLS, logger, streamAskAgent } from 'core';
import { z } from 'zod';
import type { ChatMessage } from '../../../chat/chat-message';

// The ask-agent needs Node (pg, fs logging) — never the edge runtime.
export const runtime = 'nodejs';

// Only the request's outer shape is checked here; the messages themselves
// are validated by the `ai` package against the ask-agent's real toolset,
// and the resulting conversation once more by core (streamAskAgent).
const ChatRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(100),
});

const STREAM_ERROR_MESSAGE =
  'Hiba történt a válasz közben. Kérlek, próbáld újra.';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // The parse error's message quotes the body, so it is not logged.
    return badRequest('api_chat.invalid_json');
  }

  let messages: ChatMessage[];
  try {
    const { messages: rawMessages } = ChatRequestSchema.parse(body);
    messages = await validateUIMessages<ChatMessage>({
      messages: rawMessages,
      tools: ASK_AGENT_TOOLS,
    });
  } catch (error: unknown) {
    return badRequest('api_chat.invalid_request', error);
  }

  let result: ReturnType<typeof streamAskAgent>;
  try {
    // request.signal fires when the client stops or disconnects, so the
    // model call is stopped server-side too (and logged as `aborted`).
    result = streamAskAgent(convertToModelMessages(messages), {
      abortSignal: request.signal,
    });
  } catch (error: unknown) {
    return badRequest('api_chat.invalid_request', error);
  }

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onError: (error: unknown) => {
      // Full detail stays in the server log; the browser gets a generic
      // message (konvenciok.md: UI-facing message + detailed server log).
      logger.error('api_chat.stream_failed', { error });
      return STREAM_ERROR_MESSAGE;
    },
  });
}

function badRequest(event: string, error?: unknown): Response {
  logger.error(
    event,
    error === undefined ? {} : { error: withoutInputValue(error) },
  );
  return Response.json({ error: 'Érvénytelen kérés.' }, { status: 400 });
}

/**
 * The `ai` package's TypeValidationError quotes the whole validated value
 * — here the user's messages — in its message and stack, so only its cause
 * (the Zod error, which does not include the input) is logged.
 */
function withoutInputValue(error: unknown): unknown {
  if (TypeValidationError.isInstance(error)) {
    return error.cause instanceof Error
      ? error.cause
      : new Error('Type validation failed.');
  }
  return error;
}
