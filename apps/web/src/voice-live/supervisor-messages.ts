// The supervisor's messages: the user's approximate transcripts are the
// conversation (user role only, the last one is the main question); the
// realtime model's own phrasing of the question is only tagged help. Nothing
// from the client or the realtime model is ever a system message, and angle
// brackets are neutralised so neither text can close or fake the tag.

import type { ModelMessage } from 'ai';

export const PHRASING_TAG = 'recepcios_megfogalmazas';

const neutralise = (text: string): string => text.replace(/[<>]/g, ' ');

export interface SupervisorMessagesInput {
  question: string;
  transcripts?: readonly string[];
}

export function buildSupervisorMessages({
  question,
  transcripts = [],
}: SupervisorMessagesInput): ModelMessage[] {
  const words = transcripts.map(neutralise);
  const last = words.at(-1);
  if (last === undefined) {
    return [{ role: 'user', content: question }];
  }
  return [
    ...words.slice(0, -1).map((text): ModelMessage => ({ role: 'user', content: text })),
    {
      role: 'user',
      content: `${last}

<${PHRASING_TAG}>${neutralise(question)}</${PHRASING_TAG}>`,
    },
  ];
}
