// packages/core/src/tools/search-knowledge/hyde-generate.ts
//
// docs/rag-proposal.md #5-6: HyDE step. Generates an ENGLISH hypothetical
// answer passage from the (Hungarian) user query, in the style of the
// data/knowledge corpus (The Sill blog) — embedding this passage instead of
// the raw query is what "HyDE" means, and writing it in the corpus's
// language (not the query's) is the nyelvi routing decision from
// dontesek-hf3.md #9 / rag-proposal.md #6.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Cheap/fast model on purpose: this is an internal retrieval-quality step,
// not the user-facing answer (rag-proposal.md #4 routing table).
const HYDE_MODEL: Anthropic.Model = 'claude-haiku-4-5-20251001';
const HYDE_MAX_TOKENS = 200;

const HYDE_SYSTEM_PROMPT = `
<role>
A plant-care blog (The Sill) writer's voice and style.
</role>
<task>
Given a plant-care question (it may be in Hungarian or English), write a
short, ENGLISH hypothetical passage that answers it, in the style of a
typical plant-care blog article — even if you are not certain of the exact
answer. This text is the input to a semantic search, not the final answer
shown to a user.
</task>
<rules>
- Always write in English, even if the question is in Hungarian.
- 2-4 sentences, concise.
- Do not mention that this is "hypothetical" — write it as if it were a
  real excerpt from an article.
</rules>
`.trim();

const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export interface HydeDeps {
  /** Injectable for tests; defaults to a real Anthropic client. */
  client?: Anthropic;
}

/**
 * Generates the HyDE passage for `query`. Throws if the model returns no
 * text content (mirrors agent-loop.ts's extractFinalText).
 */
export async function generateHydePassage(
  query: string,
  deps: HydeDeps = {},
): Promise<string> {
  const client = deps.client ?? new Anthropic();

  const response = await client.messages.create({
    model: HYDE_MODEL,
    max_tokens: HYDE_MAX_TOKENS,
    system: HYDE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: query }],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (!textBlock) {
    throw new Error('HyDE generation returned no text content.');
  }

  return TextBlockSchema.parse(textBlock).text;
}
