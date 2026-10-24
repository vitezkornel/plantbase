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
  const transcripts: string[][] = [];
  const deps: LiveSessionDeps = {
    sessionId: 's1',
    filler: true,
    demoOrders: false,
    send: (e) => sent.push(e),
    fetchSupervisor: (_q, signal, seenTranscripts) =>
      new Promise((resolve, reject) => {
        signals.push(signal);
        transcripts.push([...seenTranscripts]);
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
    transcripts,
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

  it('should run a tool call end to end, passing the approximate transcripts along', async () => {
    const h = setup();
    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'mi a potosz',
    });

    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'Könnyű.', escalated: false });
    await flush();

    expect(h.transcripts).toEqual([['mi a potosz']]);
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

  it('should show the supervisor main question (transcript) and the receptionist phrasing on separate lines', () => {
    const h = setup();
    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'És melyik macskabarát?',
    });

    h.session.onEvent(askCall('Melyik kaktusz igényel kevesebb locsolást?'));

    expect(lineOf(h.emitted, 'supervisor-question')).toBe(
      'Supervisor fő kérdése (átirat): És melyik macskabarát?',
    );
    expect(lineOf(h.emitted, 'question')).toBe(
      'Recepciós megfogalmazása: Melyik kaktusz igényel kevesebb locsolást?',
    );
    h.session.dispose();
  });

  it('should say so when there is no transcript and the phrasing is all the supervisor has', () => {
    const h = setup();

    h.session.onEvent(askCall('Milyen kaktuszok vannak?'));

    expect(lineOf(h.emitted, 'supervisor-question')).toBe(
      'Supervisor fő kérdése (átirat): nincs átirat, a recepciós megfogalmazása megy',
    );
    h.session.dispose();
  });

  it('should hand the model the transcript the supervisor treated as the main question', async () => {
    const h = setup();
    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'És melyik macskabarát?',
    });
    h.session.onEvent(askCall('Melyik kaktusz igényel kevesebb locsolást?'));

    h.resolveNext({ answer: 'Mindhárom macskabarát.', escalated: false });
    await flush();

    const output = h.sent.find(
      (e) => (e as { type: string }).type === 'conversation.item.create',
    ) as { item: { output: string } };
    expect(JSON.parse(output.item.output)).toEqual({
      userQuestion: 'És melyik macskabarát?',
      answer: 'Mindhárom macskabarát.',
      escalated: false,
    });
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

describe('createLiveSession — transcripts for the supervisor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const said = (session: { onEvent(e: never): void }, transcript: string) =>
    session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript,
    } as never);

  it('should pass the last six transcripts, oldest first', async () => {
    const h = setup();
    for (let i = 1; i <= 8; i += 1) {
      said(h.session, `mondat ${i}`);
    }

    h.session.onEvent(askCall());
    await flush();

    expect(h.transcripts[0]).toEqual([
      'mondat 3',
      'mondat 4',
      'mondat 5',
      'mondat 6',
      'mondat 7',
      'mondat 8',
    ]);
    h.session.dispose();
  });

  it('should wait for the transcript of the turn that just ended before asking', async () => {
    const h = setup();
    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.session.onEvent(askCall());
    await flush();

    expect(h.transcripts).toEqual([]);

    said(h.session, 'Milyen kaktuszaitok vannak?');
    await flush();

    expect(h.transcripts).toEqual([['Milyen kaktuszaitok vannak?']]);
    h.session.dispose();
  });

  it('should give up waiting after about a second and a half', async () => {
    const h = setup();
    said(h.session, 'korábbi mondat');
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.session.onEvent(askCall());

    await vi.advanceTimersByTimeAsync(1400);
    expect(h.transcripts).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);

    expect(h.transcripts).toEqual([[]]);
    h.session.dispose();
  });

  it('should not wait when the transcript has already arrived', async () => {
    const h = setup();
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    said(h.session, 'Milyen kaktuszaitok vannak?');
    h.session.onEvent(askCall());
    await flush();

    expect(h.transcripts).toEqual([['Milyen kaktuszaitok vannak?']]);
    h.session.dispose();
  });

  it('should not ask the supervisor at all when the user speaks again while it waits', async () => {
    const h = setup();
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.session.onEvent(askCall());

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    await vi.advanceTimersByTimeAsync(3000);

    expect(h.transcripts).toEqual([]);
    h.session.dispose();
  });

  it('should not keep waiting for every later call after a transcript never came', async () => {
    const h = setup();
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.session.onEvent(askCall());
    await vi.advanceTimersByTimeAsync(1600);
    expect(h.transcripts).toHaveLength(1);

    h.session.onEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'c2',
      name: 'askPlantbase',
      arguments: JSON.stringify({ question: 'újra' }),
    });
    await flush();

    expect(h.transcripts).toHaveLength(2);
    h.session.dispose();
  });
});

describe('createLiveSession — partial timings in the event log', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const timings = (emitted: LiveAction[]) =>
    logs(emitted)
      .filter((l) => l.kind === 'timing')
      .map((l) => l.text);

  it('should show how long the supervisor request itself took', async () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.advance(3200);
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    expect(timings(h.emitted)).toContain('Részidő: supervisor-kérés (fetch) 3.2 s');
    expect(timings(h.emitted).join('|')).not.toContain('átirat-várakozás');
    h.session.dispose();
  });

  it('should show the wait for the transcript separately from the request', async () => {
    const h = setup();
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.session.onEvent(askCall());

    h.advance(700);
    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Milyen kaktuszaitok vannak?',
    });
    await flush();
    h.advance(2000);
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    expect(timings(h.emitted)).toContain('Részidő: átirat-várakozás 0.7 s');
    expect(timings(h.emitted)).toContain('Részidő: supervisor-kérés (fetch) 2.0 s');
    h.session.dispose();
  });

  it('should split the request into server time and the rest', async () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.advance(15600);
    h.resolveNext({ answer: 'x', escalated: false, serverMs: 5900 });
    await flush();

    expect(timings(h.emitted)).toContain(
      'Részidő: ebből a szerver 5.9 s, a többi (hálózat, route-indulás) 9.7 s',
    );
    h.session.dispose();
  });

  it('should show when the result was handed to the model', async () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    expect(timings(h.emitted)).toContain('Részidő: eredmény elküldve a modellnek');
    h.session.dispose();
  });

  it('should show that the result was held while the model was speaking, and for how long', async () => {
    const h = setup();
    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    expect(timings(h.emitted)).toContain('Részidő: eredmény tartva, a modell még beszél');

    h.advance(1200);
    h.session.onEvent({ type: 'response.done' });

    expect(timings(h.emitted)).toContain(
      'Részidő: eredmény elküldve a modellnek (tartva 1.2 s)',
    );
    h.session.dispose();
  });

  it('should not show request timings for a call that was cut off by the user', async () => {
    const h = setup();
    h.session.onEvent(askCall());

    h.session.onEvent({ type: 'input_audio_buffer.speech_started' });
    await flush();

    expect(timings(h.emitted)).toEqual([]);
    h.session.dispose();
  });
});

describe('createLiveSession — a missing transcript must not promote an old one', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const said = (session: { onEvent(e: never): void }, transcript: string) =>
    session.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript,
    } as never);
  const outputOf = (sent: object[]) =>
    JSON.parse(
      (
        sent.find(
          (e) => (e as { type: string }).type === 'conversation.item.create',
        ) as { item: { output: string } }
      ).item.output,
    ) as Record<string, unknown>;

  it('should send the model question alone when the transcript is late, not the previous turn as the main question', async () => {
    const h = setup();
    said(h.session, 'Mennyibe kerül a monstera?');
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.session.onEvent(askCall('Mennyibe kerül a fikusz?'));

    await vi.advanceTimersByTimeAsync(1600);
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();

    expect(h.transcripts).toEqual([[]]);
    expect(outputOf(h.sent).userQuestion).toBe('Mennyibe kerül a fikusz?');
  });

  it('should not wait, and not use the old transcript, when the turn produced an empty transcript', async () => {
    const h = setup();
    said(h.session, 'Mennyibe kerül a monstera?');
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    said(h.session, '   ');

    h.session.onEvent(askCall('Mi ez?'));
    await flush();

    expect(h.transcripts).toEqual([[]]);
  });

  it('should treat a failed transcription like a missing one', async () => {
    const h = setup();
    said(h.session, 'Mennyibe kerül a monstera?');
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    h.session.onEvent({
      type: 'conversation.item.input_audio_transcription.failed',
    });

    h.session.onEvent(askCall('Mi ez?'));
    await flush();

    expect(h.transcripts).toEqual([[]]);
  });

  it('should use the transcripts again once a new turn has one', async () => {
    const h = setup();
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    said(h.session, '   ');
    h.session.onEvent({ type: 'input_audio_buffer.speech_stopped' });
    said(h.session, 'És a fikusz?');

    h.session.onEvent(askCall('Mennyibe kerül a fikusz?'));
    await flush();

    expect(h.transcripts).toEqual([['És a fikusz?']]);
  });
});

describe('createLiveSession — a held answer survives any failure of the nudge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const creates = (sent: object[]) =>
    sent.filter((e) => (e as { type: string }).type === 'response.create');

  it.each([
    ['a server error code', { type: 'error', error: { code: 'server_error', message: 'x' } }],
    ['no error code', { type: 'error', error: { message: 'x' } }],
  ])('should still send the answer after the nudge failed with %s', async (_name, error) => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    vi.advanceTimersByTime(NUDGE_DELAY_MS); // nudge create in flight
    h.resolveNext({ answer: 'x', escalated: false });
    await flush(); // answer held behind the nudge
    expect(creates(h.sent)).toHaveLength(1);

    h.session.onEvent(error);
    await vi.advanceTimersByTimeAsync(1000);

    expect(creates(h.sent)).toHaveLength(2);
    h.session.dispose();
  });
});

describe('createLiveSession — bounded answer retries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const creates = (sent: object[]) =>
    sent.filter((e) => (e as { type: string }).type === 'response.create');
  const ACTIVE = {
    type: 'error',
    error: { code: 'conversation_already_has_active_response', message: 'busy' },
  };

  it('should retry a refused answer at most three times, then report it and stop', async () => {
    const h = setup();
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush(); // create #1

    for (let i = 0; i < 6; i += 1) {
      h.session.onEvent(ACTIVE);
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(creates(h.sent)).toHaveLength(4); // the first send + 3 retries
    const errorLines = logs(h.emitted)
      .filter((l) => l.kind === 'error')
      .map((l) => l.text);
    expect(errorLines.some((l) => /nem sikerült[^.]*3 próbálkozás/.test(l))).toBe(true);
    h.session.dispose();
  });

  it('should not send anything more after giving up, even at response.done', async () => {
    const h = setup();
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();
    for (let i = 0; i < 4; i += 1) {
      h.session.onEvent(ACTIVE);
      await vi.advanceTimersByTimeAsync(1000);
    }
    const before = creates(h.sent).length;

    h.session.onEvent({ type: 'response.created' });
    h.session.onEvent({ type: 'response.done' });

    expect(creates(h.sent)).toHaveLength(before);
    h.session.dispose();
  });

  it('should count retries per answer, so the next tool call gets its own three', async () => {
    const h = setup();
    h.session.onEvent(askCall());
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();
    for (let i = 0; i < 4; i += 1) {
      h.session.onEvent(ACTIVE);
      await vi.advanceTimersByTimeAsync(1000);
    }

    h.session.onEvent({
      type: 'response.function_call_arguments.done',
      call_id: 'c2',
      name: 'askPlantbase',
      arguments: JSON.stringify({ question: 'újra' }),
    });
    h.resolveNext({ answer: 'y', escalated: false });
    await flush();
    h.session.onEvent(ACTIVE);
    await vi.advanceTimersByTimeAsync(1000);

    expect(creates(h.sent).length).toBeGreaterThanOrEqual(6);
    h.session.dispose();
  });
});

describe('createLiveSession — a response.create that is never acknowledged', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const creates = (sent: object[]) =>
    sent.filter((e) => (e as { type: string }).type === 'response.create');
  const errorLines = (emitted: LiveAction[]) =>
    logs(emitted)
      .filter((l) => l.kind === 'error')
      .map((l) => l.text);

  it('should free the busy state, with an event log line, after five seconds of silence', async () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    vi.advanceTimersByTime(NUDGE_DELAY_MS); // nudge create in flight

    await vi.advanceTimersByTimeAsync(5000);

    expect(errorLines(h.emitted).some((l) => /response.create-re 5 s alatt/.test(l))).toBe(true);
    h.resolveNext({ answer: 'x', escalated: false });
    await flush();
    expect(creates(h.sent)).toHaveLength(2); // sent at once, not held
    h.session.dispose();
  });

  it('should send an answer that was held behind the silent create once it is freed', async () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    vi.advanceTimersByTime(NUDGE_DELAY_MS);
    h.resolveNext({ answer: 'x', escalated: false });
    await flush(); // held
    expect(creates(h.sent)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);

    expect(creates(h.sent)).toHaveLength(2);
    h.session.dispose();
  });

  it('should not complain when response.created arrives in time', async () => {
    const h = setup({ filler: true });
    h.session.onEvent(askCall());
    vi.advanceTimersByTime(NUDGE_DELAY_MS);
    h.session.onEvent({ type: 'response.created' });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(errorLines(h.emitted)).toEqual([]);
    h.session.dispose();
  });
});
