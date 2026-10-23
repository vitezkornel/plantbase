// Runs the realtime model's tool calls in the browser. askPlantbase goes to
// our supervisor endpoint; getOrderStatus is the DEMO fake. Two rules shape
// it: tool arguments are untrusted (the model wrote them), and a call that
// the user talks over is STALE — its request is aborted and its result never
// reaches the model as an answer.

import { DEMO_DELAY_MS, FAKE_ORDER } from './demo-orders';
import type { FunctionCall } from './realtime-events';
import {
  ASK_PLANTBASE_TOOL_NAME,
  GET_ORDER_STATUS_TOOL_NAME,
} from './realtime-tools';

export interface SupervisorResult {
  answer: string;
  escalated: boolean;
}

export interface DispatchInfo {
  callId: string;
  name: string;
  outcome: 'answered' | 'failed' | 'stale';
  ms: number;
  escalated: boolean;
  demo: boolean;
}

export interface DispatchDeps {
  fetchSupervisor(
    question: string,
    signal: AbortSignal,
  ): Promise<SupervisorResult>;
  send(event: object): void;
  demoOrders: boolean;
  demoDelayMs?: number;
  now?: () => number;
  onSettled(info: DispatchInfo): void;
}

export interface ToolDispatcher {
  handle(call: FunctionCall): void;
  /** The user started a new turn: abort what is in flight, mark it stale. */
  interrupt(): void;
  dispose(): void;
}

const FAILED_OUTPUT = {
  error: true,
  message: 'Nem sikerült választ kapni a katalógustól.',
};
const STALE_OUTPUT = {
  stale: true,
  message:
    'A felhasználó közben új kérdést tett fel; ez az eredmény elavult, ne mondd el.',
};

interface InFlight {
  call: FunctionCall;
  startedAt: number;
  demo: boolean;
  abort: () => void;
}

function parseQuestion(rawArguments: string): string | null {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'question' in parsed &&
      typeof parsed.question === 'string' &&
      parsed.question.trim() !== ''
    ) {
      return parsed.question.trim();
    }
  } catch {
    // fall through: malformed arguments
  }
  return null;
}

export function createToolDispatcher(deps: DispatchDeps): ToolDispatcher {
  const now = deps.now ?? Date.now;
  const inFlight = new Map<string, InFlight>();
  let disposed = false;

  const sendOutput = (callId: string, output: object): void => {
    deps.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
  };

  const settle = (
    entry: InFlight,
    outcome: DispatchInfo['outcome'],
    escalated = false,
  ): void => {
    inFlight.delete(entry.call.callId);
    deps.onSettled({
      callId: entry.call.callId,
      name: entry.call.name,
      outcome,
      ms: now() - entry.startedAt,
      escalated,
      demo: entry.demo,
    });
  };

  const respondWithError = (callId: string): void => {
    sendOutput(callId, FAILED_OUTPUT);
    deps.send({ type: 'response.create' });
  };

  const handleAsk = (call: FunctionCall): void => {
    const question = parseQuestion(call.rawArguments);
    if (question === null) {
      respondWithError(call.callId);
      return;
    }
    const controller = new AbortController();
    const entry: InFlight = {
      call,
      startedAt: now(),
      demo: false,
      abort: () => controller.abort(),
    };
    inFlight.set(call.callId, entry);

    deps.fetchSupervisor(question, controller.signal).then(
      (result) => {
        if (!inFlight.has(call.callId)) {
          return; // stale: already answered with the stale marker
        }
        sendOutput(call.callId, result);
        deps.send({ type: 'response.create' });
        settle(entry, 'answered', result.escalated);
      },
      () => {
        if (!inFlight.has(call.callId)) {
          return;
        }
        respondWithError(call.callId);
        settle(entry, 'failed');
      },
    );
  };

  const handleOrder = (call: FunctionCall): void => {
    if (!deps.demoOrders) {
      respondWithError(call.callId);
      return;
    }
    const timer = setTimeout(() => {
      if (!inFlight.has(call.callId)) {
        return;
      }
      sendOutput(call.callId, FAKE_ORDER);
      deps.send({ type: 'response.create' });
      settle(entry, 'answered');
    }, deps.demoDelayMs ?? DEMO_DELAY_MS);
    const entry: InFlight = {
      call,
      startedAt: now(),
      demo: true,
      abort: () => clearTimeout(timer),
    };
    inFlight.set(call.callId, entry);
  };

  return {
    handle: (call) => {
      if (disposed) {
        return;
      }
      if (call.name === ASK_PLANTBASE_TOOL_NAME) {
        handleAsk(call);
      } else if (call.name === GET_ORDER_STATUS_TOOL_NAME) {
        handleOrder(call);
      } else {
        respondWithError(call.callId);
      }
    },
    interrupt: () => {
      for (const entry of [...inFlight.values()]) {
        entry.abort();
        // Keep the conversation consistent (a call needs an output) but do
        // NOT ask the model to answer it: the user is already talking.
        sendOutput(entry.call.callId, STALE_OUTPUT);
        settle(entry, 'stale');
      }
    },
    dispose: () => {
      disposed = true;
      for (const entry of [...inFlight.values()]) {
        entry.abort();
        inFlight.delete(entry.call.callId);
      }
    },
  };
}
