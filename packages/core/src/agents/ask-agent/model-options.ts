// packages/core/src/agents/ask-agent/model-options.ts
//
// Provider options of the ask-agent's model call per interaction mode.
// `text` mode sends none (its request stays exactly as it was). The spoken
// modes switch the model's thinking off: without the field the API applies
// the model's default (adaptive thinking), and on a spoken answer the
// thinking tokens are pure latency. `VOICE_THINKING` overrides it:
// `off` (default) | `low` | `medium` | `high` (an effort level instead of
// switching thinking off) | `default` (leave the provider default).

import type { streamText } from 'ai';
import type { AskAgentMode } from './ask-agent-stream.js';

type ProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]['providerOptions']
>;

const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;

export function anthropicOptionsFor(
  mode: AskAgentMode,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProviderOptions | undefined {
  if (mode === 'text') {
    return undefined;
  }
  const setting = env['VOICE_THINKING']?.trim().toLowerCase();
  if (setting === 'default') {
    return undefined;
  }
  const effort = EFFORT_LEVELS.find((level) => level === setting);
  if (effort !== undefined) {
    return { anthropic: { effort } };
  }
  return { anthropic: { thinking: { type: 'disabled' } } };
}
