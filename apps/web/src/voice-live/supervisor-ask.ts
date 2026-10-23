// The supervisor's one call into the ask-agent: voice-live mode, the question
// as the only message (no history — the realtime model writes a self-contained
// question), the full answer awaited. The approximate transcript is passed
// for the JSONL log only; it never reaches the model.

import { streamAskAgent } from 'core';

export interface AskInput {
  question: string;
  clientTranscript?: string;
  signal: AbortSignal;
}

export async function askSupervisor({
  question,
  clientTranscript,
  signal,
}: AskInput): Promise<string> {
  const result = streamAskAgent([{ role: 'user', content: question }], {
    mode: 'voice-live',
    abortSignal: signal,
    ...(clientTranscript === undefined ? {} : { clientTranscript }),
  });
  return await result.text;
}
