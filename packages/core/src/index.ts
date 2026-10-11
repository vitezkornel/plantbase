// core's public API — named on purpose (konvenciok.md: explicit public API,
// low coupling): the model id, token cap and log helpers stay internal.
export {
  ASK_AGENT_TOOLS,
  askAgent,
  ESCALATE_PREFIX,
  type AskAgentResult,
  type AskAgentTools,
} from './agents/ask-agent/ask-agent.js';
export {
  streamAskAgent,
  type StreamAskAgentOptions,
} from './agents/ask-agent/ask-agent-stream.js';
export { logger, type LogLevel } from './logging/structured-logger.js';
