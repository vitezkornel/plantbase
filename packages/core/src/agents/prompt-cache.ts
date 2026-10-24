// packages/core/src/agents/prompt-cache.ts
//
// Anthropic prompt caching: the cache covers the request prefix up to a
// marked breakpoint, in the order tools -> system -> messages. One
// breakpoint on the system prompt therefore caches the (large, unchanging)
// tool definitions and the system prompt together; the conversation after
// it is not cached. The Vercel AI SDK `system` option has no provider
// options, so the system prompt travels as the first message instead.

import type { ModelMessage } from 'ai';

export function cachedSystemMessage(system: string): ModelMessage {
  return {
    role: 'system',
    content: system,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  };
}
