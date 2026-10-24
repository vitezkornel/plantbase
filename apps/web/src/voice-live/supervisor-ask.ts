// The supervisor's one call into the ask-agent: voice-live mode, the question
// as the only message (no history — the realtime model writes a self-contained
// question), the full answer awaited. The approximate transcript is passed
// for the JSONL log only; it never reaches the model.

import { streamAskAgent } from 'core';
import { buildSupervisorMessages } from './supervisor-messages';

export interface AskInput {
  question: string;
  transcripts?: readonly string[];
  signal: AbortSignal;
}

export async function askSupervisor({
  question,
  transcripts,
  signal,
}: AskInput): Promise<string> {
  const clientTranscript = transcripts?.at(-1);
  const result = streamAskAgent(
    buildSupervisorMessages({ question, transcripts }),
    {
      mode: 'voice-live',
      abortSignal: signal,
      ...(clientTranscript === undefined ? {} : { clientTranscript }),
    },
  );
  return await result.text;
}
