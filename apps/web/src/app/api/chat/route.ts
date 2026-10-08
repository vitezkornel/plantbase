import 'server-only';
import { convertToModelMessages, validateUIMessages } from 'ai';
import { ASK_AGENT_TOOLS, streamAskAgent } from 'core';
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
  let messages: ChatMessage[];
  try {
    const { messages: rawMessages } = ChatRequestSchema.parse(
      await request.json(),
    );
    messages = await validateUIMessages<ChatMessage>({
      messages: rawMessages,
      tools: ASK_AGENT_TOOLS,
    });
  } catch (error: unknown) {
    return badRequest(error);
  }

  let result: ReturnType<typeof streamAskAgent>;
  try {
    result = streamAskAgent(convertToModelMessages(messages));
  } catch (error: unknown) {
    return badRequest(error);
  }

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onError: (error: unknown) => {
      // Full detail stays in the server log; the browser gets a generic
      // message (konvenciok.md: UI-facing message + detailed server log).
      console.error('POST /api/chat: stream failed', error);
      return STREAM_ERROR_MESSAGE;
    },
  });
}

function badRequest(error: unknown): Response {
  const detail = error instanceof Error ? error.message : String(error);
  console.error('POST /api/chat: invalid request', detail);
  return Response.json({ error: 'Érvénytelen kérés.' }, { status: 400 });
}
