import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_DELAY_MS, FAKE_ORDER } from './demo-orders';
import {
  createToolDispatcher,
  type DispatchDeps,
  type DispatchInfo,
  type SupervisorResult,
} from './tool-dispatch';

interface Harness {
  sent: object[];
  settled: DispatchInfo[];
  deps: DispatchDeps;
  resolveSupervisor: (value: SupervisorResult) => void;
  rejectSupervisor: (error: unknown) => void;
  signals: AbortSignal[];
  fetchSupervisor: ReturnType<typeof vi.fn>;
}

function harness(over: Partial<DispatchDeps> = {}): Harness {
  const sent: object[] = [];
  const settled: DispatchInfo[] = [];
  const signals: AbortSignal[] = [];
  let resolveSupervisor: (value: SupervisorResult) => void = () => undefined;
  let rejectSupervisor: (error: unknown) => void = () => undefined;
  const fetchSupervisor = vi.fn(
    (_question: string, signal: AbortSignal) =>
      new Promise<SupervisorResult>((resolve, reject) => {
        signals.push(signal);
        resolveSupervisor = resolve;
        rejectSupervisor = reject;
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const deps: DispatchDeps = {
    fetchSupervisor,
    send: (event) => sent.push(event),
    demoOrders: false,
    onSettled: (info) => settled.push(info),
    ...over,
  };
  return {
    sent,
    settled,
    deps,
    resolveSupervisor: (v) => resolveSupervisor(v),
    rejectSupervisor: (e) => rejectSupervisor(e),
    signals,
    fetchSupervisor,
  };
}

const call = (name: string, args: unknown, callId = 'c1') => ({
  callId,
  name,
  rawArguments: typeof args === 'string' ? args : JSON.stringify(args),
});

const outputOf = (event: object): Record<string, unknown> =>
  JSON.parse((event as { item: { output: string } }).item.output) as Record<
    string,
    unknown
  >;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createToolDispatcher — askPlantbase', () => {
  it('should relay the supervisor answer and ask the model to continue', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call('askPlantbase', { question: 'Mi a pothos?' }));
    h.resolveSupervisor({ answer: 'Könnyű növény.', escalated: false });
    await flush();

    expect(h.fetchSupervisor.mock.calls[0][0]).toBe('Mi a pothos?');
    expect(h.sent).toEqual([
      {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: 'c1',
          output: JSON.stringify({ answer: 'Könnyű növény.', escalated: false }),
        },
      },
      { type: 'response.create' },
    ]);
    expect(h.settled[0]).toMatchObject({
      outcome: 'answered',
      escalated: false,
    });
  });

  it('should report an escalation', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call('askPlantbase', { question: 'Hol a rendelésem?' }));
    h.resolveSupervisor({ answer: 'Kolléga jelentkezik.', escalated: true });
    await flush();

    expect(outputOf(h.sent[0]).escalated).toBe(true);
    expect(h.settled[0].escalated).toBe(true);
  });

  it('should tell the model plainly when the supervisor fails', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call('askPlantbase', { question: 'k' }));
    h.rejectSupervisor(new Error('HTTP 502'));
    await flush();

    expect(outputOf(h.sent[0])).toMatchObject({ error: true });
    expect(h.sent[1]).toEqual({ type: 'response.create' });
    expect(h.settled[0].outcome).toBe('failed');
  });

  it.each([
    ['not json'],
    ['{}'],
    ['{"question":"   "}'],
    ['{"question":42}'],
    ['null'],
  ])(
    'should reject the malformed arguments %s without calling the supervisor',
    async (raw) => {
      const h = harness();
      const dispatcher = createToolDispatcher(h.deps);

      dispatcher.handle(call('askPlantbase', raw));
      await flush();

      expect(h.fetchSupervisor).not.toHaveBeenCalled();
      expect(outputOf(h.sent[0])).toMatchObject({ error: true });
      expect(h.sent[1]).toEqual({ type: 'response.create' });
    },
  );

  it('should answer an unknown tool with an error output', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call('deleteEverything', {}));
    await flush();

    expect(h.fetchSupervisor).not.toHaveBeenCalled();
    expect(outputOf(h.sent[0])).toMatchObject({ error: true });
  });
});

describe('createToolDispatcher — interruption', () => {
  it('should abort the request and mark the call stale, without asking the model to answer it', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);
    dispatcher.handle(call('askPlantbase', { question: 'k' }));

    dispatcher.interrupt();
    await flush();

    expect(h.signals[0].aborted).toBe(true);
    expect(h.sent).toHaveLength(1);
    expect(outputOf(h.sent[0])).toMatchObject({ stale: true });
    expect(h.sent).not.toContainEqual({ type: 'response.create' });
    expect(h.settled[0].outcome).toBe('stale');
  });

  it('should drop a late answer after the interruption', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);
    dispatcher.handle(call('askPlantbase', { question: 'k' }));
    dispatcher.interrupt();

    h.resolveSupervisor({ answer: 'ELAVULT-VALASZ', escalated: false });
    await flush();

    expect(JSON.stringify(h.sent)).not.toContain('ELAVULT-VALASZ');
    expect(h.sent).toHaveLength(1);
    expect(h.settled).toHaveLength(1);
  });

  it('should do nothing when nothing is in flight', () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.interrupt();

    expect(h.sent).toEqual([]);
  });

  it('should handle each in-flight call once, even on a second interrupt', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);
    dispatcher.handle(call('askPlantbase', { question: 'k' }));

    dispatcher.interrupt();
    dispatcher.interrupt();
    await flush();

    expect(h.sent).toHaveLength(1);
  });

  it('should abort and stay silent on dispose', async () => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);
    dispatcher.handle(call('askPlantbase', { question: 'k' }));

    dispatcher.dispose();
    dispatcher.dispose();
    await flush();

    expect(h.signals[0].aborted).toBe(true);
    expect(h.sent).toEqual([]);
  });
});

describe('createToolDispatcher — DEMO getOrderStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should answer with the fake order after the delay, marked demo', () => {
    const h = harness({ demoOrders: true });
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call('getOrderStatus', { orderId: '12345' }));
    vi.advanceTimersByTime(DEMO_DELAY_MS - 1);
    expect(h.sent).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(outputOf(h.sent[0])).toEqual({ ...FAKE_ORDER });
    expect(outputOf(h.sent[0]).demo).toBe(true);
    expect(h.sent[1]).toEqual({ type: 'response.create' });
    expect(h.settled[0]).toMatchObject({ demo: true, outcome: 'answered' });
    expect(h.fetchSupervisor).not.toHaveBeenCalled();
  });

  it('should refuse getOrderStatus when the demo is off', () => {
    const h = harness({ demoOrders: false });
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call('getOrderStatus', { orderId: '1' }));

    expect(outputOf(h.sent[0])).toMatchObject({ error: true });
    expect(h.fetchSupervisor).not.toHaveBeenCalled();
  });

  it('should drop the demo timer on interrupt and mark the call stale', () => {
    const h = harness({ demoOrders: true });
    const dispatcher = createToolDispatcher(h.deps);
    dispatcher.handle(call('getOrderStatus', { orderId: '1' }));

    dispatcher.interrupt();
    vi.advanceTimersByTime(DEMO_DELAY_MS * 2);

    expect(h.sent).toHaveLength(1);
    expect(outputOf(h.sent[0])).toMatchObject({ stale: true });
  });
});

describe('createToolDispatcher — settling synchronous failures', () => {
  it.each([
    ['askPlantbase', 'not json'],
    ['askPlantbase', '{"question":"   "}'],
    ['deleteEverything', '{}'],
  ])('should settle %s with %s as failed', (name, raw) => {
    const h = harness();
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call(name, raw));

    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]).toMatchObject({ name, outcome: 'failed' });
  });

  it('should settle getOrderStatus as failed when the demo is off', () => {
    const h = harness({ demoOrders: false });
    const dispatcher = createToolDispatcher(h.deps);

    dispatcher.handle(call('getOrderStatus', { orderId: '1' }));

    expect(h.settled[0]).toMatchObject({ outcome: 'failed', demo: false });
  });
});
