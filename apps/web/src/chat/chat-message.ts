import type { InferUITools, UIDataTypes, UIMessage } from 'ai';
import type { AskAgentTools } from 'core';

/**
 * A chat message as streamed by /api/chat, typed by the ask-agent's own
 * toolset — so `tool-runSql` etc. parts carry their real input/output
 * types. Type-only import: no core runtime code reaches the browser.
 */
export type ChatMessage = UIMessage<
  never,
  UIDataTypes,
  InferUITools<AskAgentTools>
>;
