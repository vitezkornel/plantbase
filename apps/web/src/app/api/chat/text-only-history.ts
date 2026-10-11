import type { ChatMessage } from '../../../chat/chat-message';

/**
 * The chat history comes from the browser, so everything in it except the
 * plain text is untrusted (konvenciok.md "Biztonság"): a forged `tool-*`
 * part could hand the model a fake "database result", a `reasoning` part
 * fake thoughts, and a part's `providerMetadata` provider options. Only the
 * text of each message is kept — the agent re-runs its tools when it needs
 * data again — and messages left without any text are dropped.
 */
export function textOnlyHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    const textParts = message.parts.flatMap((part) =>
      part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : [],
    );
    return textParts.length === 0 ? [] : [{ ...message, parts: textParts }];
  });
}
