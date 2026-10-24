import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_MS } from './idle-timer';
import { createLiveSession, type LiveSessionDeps } from './live-session';
import type { LiveAction } from './live-state';
import { NUDGE_DELAY_MS, PROGRESS_NUDGE_INSTRUCTIONS } from './progress-nudge';
import type { SupervisorResult } from './tool-dispatch';

// This suite runs under fake timers, so promise callbacks are flushed with
// advanceTimersByTimeAsync (a setTimeout-based flush would never fire).
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(over: Partial<LiveSessionDeps> = {}) {
  const sent: object[] = [];
  const emitted: LiveAction[] = [];
  const disconnects: string[] = [];
  let clock = 0;
  const signals: AbortSignal[] = [];
  const pending: Array<(r: SupervisorResult) => void> = [];
  const approx: Array<string | undefined> = [];
  const deps: LiveSessionDeps = {
    sessionId: 's1',
    filler: true,
    demoOrders: false,
    send: (e) => sent.push(e),
    fetchSupervisor: (_q, signal, approxTranscript) =>
      new Promise((resolve, reject) => {
        signals.push(signal);
        approx.push(approxTranscript);
        pending.push(resolve);
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    emit: (a) => emitted.push(a),
    onAutoDisconnect: (r) => disconnects.push(r),
    initialTurns: [],
    now: () => clock,
    ...over,
  };
  const session = createLiveSession(deps);
  return {
    session,
    sent,
    emitted,
    disconnects,
    signals,
    approx,
    resolveNext: (r: SupervisorResult) => pending.shift()?.(r),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const logs = (emitted: LiveAction[]) =>
  emitted.filter(
    (a): a is Extract<LiveAction, { type: 'log' }> => a.type === 'log',
  );
const kinds = (emitted: LiveAction[]) => logs(emitted).map((l) => l.kind);

const askCall = (question = 'Mi a pothos?') => ({
  type: 'response.function_call_arguments.done',
  call_id: 'c1',
  name: 'askPlantbase',
  arguments: JSON.stringify({ question }),
});

describe('createLiveSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should seed the earlier turns when the channel opens', () => {
    const h = setup({
      initialTurns: [{ role: 'user', text: 'Szia', approximate: false }],
    });

    h.session.onOpen();

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: 'conversation.item.create' });
    h.session.dispose();
  });

  it('should log speech start and end', () => {
    const h = setup();

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });

    expect(kinds(h.emitted)).toEqual(['speech', 'end-of-turn']);
    h.session.dispose();
  });

  it('should call speech over a speaking agent a barge-in', () => {
    const h = setup();
    h.session.onEvent({ type: 'response.created' });

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });

    expect(kinds(h.emitted)).toEqual(['barge-in']);
    h.session.dispose();
  });

  it('should stop calling it a barge-in once the response is done', () => {
    const h = setup();
    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent({ type: 'response.done' });

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });

    expect(kinds(h.emitted)).toEqual(['speech']);
    h.session.dispose();
  });

  it('should log truncation and errors', () => {
    const h = setup();

    h.session.onEvent({ type: 'conversation.item.truncated' });
    h.session.onEvent({ type: 'error', error: { message: 'boom' } });

    expect(kinds(h.emitted)).toEqual(['truncated', 'error']);
    h.session.dispose();
  });

  it('should keep the transcript, marking the user side approximate', () => {
    const h = setup();

    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'mi a potosz',
    });
    h.session.onEvent({
      type: 'response.output_audio_transcript.done',
      transcript: 'A pothos könnyű.',
    });

    expect(h.emitted.filter((a) => a.type === 'turn')).toEqual([
      {
        type: 'turn',
        turn: { role: 'user', text: 'mi a potosz', approximate: true },
      },
      {
        type: 'turn',
        turn: {
          role: 'assistant',
          text: 'A pothos könnyű.',
          approximate: false,
        },
      },
    ]);
    h.session.dispose();
  });

  it('should run a tool call end to end, passing the latest approximate transcript along', async () => {
    const h = setup();
    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'mi a potosz',
    });

    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'Könnyű.', escalated: false });
    await flush();

    expect(h.approx).toEqual(['mi a potosz']);
    expect(h.sent.at(-1)).toEqual({ type: 'response.create' });
    expect(kinds(h.emitted)).toContain('tool');
    expect(kinds(h.emitted)).toContain('supervisor');
    expect(h.emitted).toContainEqual({ type: 'new-answer' });
    h.session.dispose();
  });

  it('should raise the escalation badge for an escalated answer', async () => {
    const h = setup();

    h.session.onEvent(askCall('Hol a rendelésem?'));
    h.resolveNext({ answer: 'Kolléga.', escalated: true });
    await flush();

    expect(h.emitted).toContainEqual({ type: 'escalated' });
    h.session.dispose();
  });

  it('should measure both silences and log them at the first agent audio', () => {
    const h = setup();
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.advance(300);
    h.session.onEvent(askCall());
    h.advance(400);

    h.session.onEvent({ type: 'output_audio_buffer.started' });

    expect(h.emitted).toContainEqual({
      type: 'silence',
      measurement: { sinceSpeechStopMs: 700, sinceToolMs: 400 },
    });
    expect(kinds(h.emitted)).toContain('silence');
    h.session.dispose();
  });

  it('should call speech between the tool call and its result a filler', () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.session.onEvent({
      type: 'response.output_audio_transcript.done',
      transcript: 'Egy pillanat.',
    });

    expect(kinds(h.emitted)).toContain('filler');
    h.session.dispose();
  });

  it('should send the progress nudge once after five seconds when the filler is on', () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());

    vi.advanceTimersByTime(NUDGE_DELAY_MS * 3);

    const nudges = h.sent.filter(
      (e) => (e as { type: string }).type === 'response.create',
    );
    expect(nudges).toEqual([
      {
        type: 'response.create',
        response: { instructions: PROGRESS_NUDGE_INSTRUCTIONS },
      },
    ]);
    h.session.dispose();
  });

  it('should not nudge when the filler is off', () => {
    const h = setup({ filler: false });
    h.session.onEvent(askCall());

    vi.advanceTimersByTime(NUDGE_DELAY_MS * 3);

    expect(h.sent).toEqual([]);
    h.session.dispose();
  });

  it('should not nudge once the answer has arrived', async () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'ok', escalated: false });
    await vi.advanceTimersByTimeAsync(0);
    const before = h.sent.length;

    vi.advanceTimersByTime(NUDGE_DELAY_MS * 3);

    expect(h.sent).toHaveLength(before);
    h.session.dispose();
  });

  it('should interrupt a pending supervisor call when the user starts speaking', async () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    h.resolveNext({ answer: 'ELAVULT', escalated: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(h.signals[0].aborted).toBe(true);
    expect(JSON.stringify(h.sent)).not.toContain('ELAVULT');
    expect(kinds(h.emitted)).toContain('stale');
    h.session.dispose();
  });

  it('should disconnect after five idle minutes', () => {
    const h = setup();
    h.session.onOpen();

    vi.advanceTimersByTime(IDLE_MS);

    expect(h.disconnects).toEqual(['idle']);
    h.session.dispose();
  });

  it('should stay connected while the user keeps speaking', () => {
    const h = setup();
    h.session.onOpen();

    vi.advanceTimersByTime(IDLE_MS - 1_000);
    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    vi.advanceTimersByTime(IDLE_MS - 1_000);

    expect(h.disconnects).toEqual([]);
    h.session.dispose();
  });

  it('should be safe to dispose twice and silent afterwards', () => {
    const h = setup();
    h.session.onOpen();

    h.session.dispose();
    h.session.dispose();
    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    vi.advanceTimersByTime(IDLE_MS * 5);

    expect(h.disconnects).toEqual([]);
    expect(h.emitted).toEqual([]);
  });

  it('should ignore events of unknown types', () => {
    const h = setup();

    h.session.onEvent({ type: 'rate_limits.updated' });

    expect(h.emitted).toEqual([]);
    h.session.dispose();
  });
});

describe('createLiveSession — failed tool calls and active responses', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const instructionNudges = (sent: object[]) =>
    sent.filter(
      (e) =>
        (e as { type: string; response?: unknown }).type ===
          'response.create' &&
        (e as { response?: unknown }).response !== undefined,
    );

  it('should not nudge or call later speech a filler after malformed tool arguments', () => {
    const h = setup({ filler: true });
    h.session.onEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'c1',
      name: 'askPlantbase',
      arguments: 'not json',
    });

    vi.advanceTimersByTime(NUDGE_DELAY_MS * 3);
    h.session.onEvent({
      type: 'response.output_audio_transcript.done',
      transcript: 'Nem sikerült.',
    });

    expect(instructionNudges(h.sent)).toEqual([]);
    expect(kinds(h.emitted)).not.toContain('filler');
    expect(kinds(h.emitted)).toContain('supervisor');
    h.session.dispose();
  });

  it('should hold the answer response.create until the active response is done', async () => {
    const h = setup({ filler: true });
    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'Könnyű.', escalated: false });
    await flush();

    expect(h.sent.map((e) => (e as { type: string }).type)).toEqual([
      'conversation.item.create',
    ]);

    h.session.onEvent({ type: 'response.done' });

    expect(h.sent.at(-1)).toEqual({ type: 'response.create' });
    h.session.dispose();
  });

  it('should not nudge while a response is active', () => {
    const h = setup({ filler: true });
    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent(askCall());

    vi.advanceTimersByTime(NUDGE_DELAY_MS * 3);

    expect(instructionNudges(h.sent)).toEqual([]);
    h.session.dispose();
  });

  it('should drop a held response.create when the user starts speaking', async () => {
    const h = setup();
    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    h.session.onEvent({ type: 'response.done' });

    expect(h.sent.map((e) => (e as { type: string }).type)).not.toContain(
      'response.create',
    );
    h.session.dispose();
  });
});

describe('createLiveSession — response.create race and rejection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const types = (sent: object[]) => sent.map((e) => (e as { type: string }).type);
  const creates = (sent: object[]) =>
    sent.filter((e) => (e as { type: string }).type === 'response.create');
  const ACTIVE_ERROR = {
    type: 'error',
    error: {
      type: 'invalid_request_error',
      code: 'conversation_already_has_active_response',
      message: 'Conversation already has an active response in progress: resp_1.',
    },
  };

  it('should hold the answer while the nudge response.create is sent but not yet created', async () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    vi.advanceTimersByTime(NUDGE_DELAY_MS); // nudge create sent, no response.created yet
    h.resolveNext({ answer: 'Könnyű.', escalated: false });
    await flush();

    expect(creates(h.sent)).toHaveLength(1); // only the nudge

    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent({ type: 'response.done' });

    expect(creates(h.sent)).toHaveLength(2);
    expect(h.sent.at(-1)).toEqual({ type: 'response.create' });
    h.session.dispose();
  });

  it('should send the answer again after response.done when the API rejects it as concurrent', async () => {
    const h = setup();
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();
    expect(creates(h.sent)).toHaveLength(1);

    h.session.onEvent(ACTIVE_ERROR);
    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent({ type: 'response.done' });

    expect(creates(h.sent)).toHaveLength(2);
    h.session.dispose();
  });

  it('should retry the rejected answer shortly even when no response.done follows', async () => {
    const h = setup();
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    h.session.onEvent(ACTIVE_ERROR);
    expect(creates(h.sent)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(creates(h.sent)).toHaveLength(2);
    h.session.dispose();
  });

  it('should not requeue a rejected nudge', async () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    vi.advanceTimersByTime(NUDGE_DELAY_MS);
    h.session.onEvent(ACTIVE_ERROR);
    await vi.advanceTimersByTimeAsync(1000);

    expect(creates(h.sent)).toHaveLength(1);
    h.session.dispose();
  });

  it('should free the answer after any error for a create that never produced a response', async () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    vi.advanceTimersByTime(NUDGE_DELAY_MS);
    h.session.onEvent({ type: 'error', error: { message: 'boom' } });
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    expect(creates(h.sent)).toHaveLength(2);
    expect(types(h.sent)).toContain('conversation.item.create');
    h.session.dispose();
  });

  it('should drop the requeued answer when the user starts speaking', async () => {
    const h = setup();
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();
    h.session.onEvent(ACTIVE_ERROR);

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(creates(h.sent)).toHaveLength(1);
    h.session.dispose();
  });
});

describe('createLiveSession — what the event log shows', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const lineOf = (emitted: LiveAction[], kind: string) =>
    logs(emitted).find((l) => l.kind === kind)?.text;

  it('should show the approximate user transcript', () => {
    const h = setup();

    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Milyen kaktuszaitok vannak?',
    });

    expect(lineOf(h.emitted, 'user')).toBe(
      'TE (közelítő): Milyen kaktuszaitok vannak?',
    );
    h.session.dispose();
  });

  it('should show the question handed to the supervisor', () => {
    const h = setup();

    h.session.onEvent(askCall('Milyen kaktuszok vannak?'));

    expect(lineOf(h.emitted, 'question')).toBe(
      'Kérdés a supervisornak: Milyen kaktuszok vannak?',
    );
    h.session.dispose();
  });

  it('should not show a question line for malformed arguments', () => {
    const h = setup();

    h.session.onEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'c1',
      name: 'askPlantbase',
      arguments: 'not json',
    });

    expect(lineOf(h.emitted, 'question')).toBeUndefined();
    h.session.dispose();
  });

  it('should show the supervisor answer briefly', async () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.resolveNext({ answer: 'x'.repeat(500), escalated: false });
    await flush();

    const text = lineOf(h.emitted, 'answer') ?? '';
    expect(text.startsWith('Supervisor válasza: xxx')).toBe(true);
    expect(text.length).toBeLessThan(260);
    expect(text.endsWith('…')).toBe(true);
    h.session.dispose();
  });

  it('should show a short supervisor answer in full', async () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.resolveNext({ answer: 'Könnyű.', escalated: false });
    await flush();

    expect(lineOf(h.emitted, 'answer')).toBe('Supervisor válasza: Könnyű.');
    h.session.dispose();
  });

  it('should show what the assistant said once no tool call is pending', () => {
    const h = setup();

    h.session.onEvent({
      type: 'response.output_audio_transcript.done',
      transcript: 'A pothos könnyű.',
    });

    expect(lineOf(h.emitted, 'assistant')).toBe('Asszisztens: A pothos könnyű.');
    h.session.dispose();
  });
});
