import { MockSpeechModelV2, MockTranscriptionModelV2 } from 'ai/test';
import { streamAskAgent } from 'core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFillerCache, warmFillers } from './filler-cache';
import { STILL_SEARCHING_TEXT } from './filler-texts';
import type { VoiceEvent } from './voice-events';
import type { VoiceDeps } from './voice-providers';
import type { HistoryMessage } from './voice-request-schema';
import { runVoiceTurn, STILL_SEARCHING_DELAY_MS } from './voice-turn';

vi.mock('core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('core')>()),
  streamAskAgent: vi.fn(),
}));

type Part =
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'error'; error: unknown }
  | { type: 'finish' };

function agentStreaming(parts: AsyncIterable<Part>) {
  vi.mocked(streamAskAgent).mockReturnValue({
    fullStream: parts,
  } as unknown as ReturnType<typeof streamAskAgent>);
}

async function* ofParts(...parts: Part[]): AsyncGenerator<Part> {
  for (const part of parts) {
    yield part;
  }
}

const text = (value: string): Part => ({
  type: 'text-delta',
  id: 't',
  text: value,
});
const toolCall = (toolName: string): Part => ({
  type: 'tool-call',
  toolCallId: 'c1',
  toolName,
  input: {},
});
const finish: Part = { type: 'finish' };

function makeDeps(transcript = 'Milyen kaktuszaitok vannak?'): VoiceDeps {
  return {
    config: {
      apiKey: 'k',
      sttModel: 'gpt-transcribe',
      ttsModel: 'tts',
      voice: 'coral',
    },
    transcriptionModel: new MockTranscriptionModelV2({
      doGenerate: async () => ({
        text: transcript,
        segments: [],
        language: 'hu',
        durationInSeconds: 3,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      }),
    }),
    speechModel: new MockSpeechModelV2({
      doGenerate: async () => ({
        audio: new Uint8Array([1, 2, 3]),
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      }),
    }),
  };
}

const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

async function runTurn(deps: VoiceDeps, history: HistoryMessage[] = []) {
  const events: VoiceEvent[] = [];
  await runVoiceTurn({
    deps,
    audio: webmBytes,
    history,
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });
  return events;
}

const types = (events: VoiceEvent[]) => events.map((e) => e.type);

function ofType<T extends VoiceEvent['type']>(
  events: VoiceEvent[],
  type: T,
): Extract<VoiceEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<VoiceEvent, { type: T }> => e.type === type,
  );
}

const quietWarm = {
  model: 'tts',
  voice: 'coral',
  synthesize: async () => new Uint8Array([9]),
  onFailure: () => undefined,
};

beforeEach(() => {
  clearFillerCache();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(streamAskAgent).mockReset();
});

describe('runVoiceTurn', () => {
  it('should emit transcript, text, sentences, timing and done in order', async () => {
    agentStreaming(
      ofParts(text('Van néhány. '), text('Például a mamilláriák.'), finish),
    );

    const events = await runTurn(makeDeps());

    expect(types(events)).toEqual([
      'transcript',
      'first-token',
      'text-delta',
      'text-delta',
      'sentence',
      'sentence',
      'timing',
      'done',
    ]);
    expect(ofType(events, 'sentence').map((s) => s.index)).toEqual([0, 1]);
  });

  it('should ask the agent in voice mode with the history plus the transcript', async () => {
    agentStreaming(ofParts(text('Szia.'), finish));

    await runTurn(makeDeps('És az pet-safe?'), [
      { role: 'user', content: 'Mutass kaktuszt' },
      { role: 'assistant', content: 'Itt egy.' },
    ]);

    const [messages, options] = vi.mocked(streamAskAgent).mock.calls[0] ?? [];
    expect(options).toMatchObject({ mode: 'voice' });
    expect(messages?.at(-1)).toEqual({
      role: 'user',
      content: 'És az pet-safe?',
    });
    expect(messages).toHaveLength(3);
  });

  it('should not call the agent or the TTS when the recording was silent', async () => {
    const events = await runTurn(makeDeps(''));

    expect(events).toEqual([
      { type: 'error', message: 'Nem hallottam semmit, próbáld újra.' },
    ]);
    expect(streamAskAgent).not.toHaveBeenCalled();
  });

  it('should mark an escalation, show the text without the prefix and not speak the prefix', async () => {
    agentStreaming(
      ofParts(
        text('[ESCAL'),
        text('ATE] Egy kollégánk jelentkezik.'),
        finish,
      ),
    );

    const events = await runTurn(makeDeps());

    expect(types(events)).toContain('escalated');
    const shown = ofType(events, 'text-delta')
      .map((e) => e.text)
      .join('');
    expect(shown).toBe('Egy kollégánk jelentkezik.');
    expect(ofType(events, 'sentence').map((s) => s.text)).toEqual([
      'Egy kollégánk jelentkezik.',
    ]);
  });

  it('should speak markdown as plain text', async () => {
    agentStreaming(
      ofParts(
        text('**Monstera** a [legjobb](https://x.hu) választás.'),
        finish,
      ),
    );

    const events = await runTurn(makeDeps());

    expect(ofType(events, 'sentence').map((s) => s.text)).toEqual([
      'Monstera a legjobb választás.',
    ]);
  });

  it('should cap the spoken text and close with the short closing line', async () => {
    agentStreaming(
      ofParts(text('Ez egy hosszú mondat. '.repeat(80)), finish),
    );

    const events = await runTurn(makeDeps());

    const spoken = ofType(events, 'sentence').map((s) => s.text);
    expect(spoken.at(-1)).toBe('A többit leírva láthatod.');
    expect(spoken.join(' ').length).toBeLessThan(1300);
  });

  it('should play a ready filler when a tool call starts, and report the tool', async () => {
    await warmFillers(quietWarm);
    agentStreaming(ofParts(toolCall('runSql'), text('Kész.'), finish));

    const events = await runTurn(makeDeps());

    expect(ofType(events, 'tool')).toEqual([{ type: 'tool', name: 'runSql' }]);
    expect(ofType(events, 'filler')[0]).toMatchObject({
      text: 'Megnézem a katalógusban…',
    });
  });

  it('should skip the filler instead of waiting when it is not ready', async () => {
    agentStreaming(ofParts(toolCall('runSql'), text('Kész.'), finish));

    const events = await runTurn(makeDeps());

    expect(types(events)).not.toContain('filler');
  });

  it('should play the "still searching" filler after 5 seconds without text', async () => {
    vi.useFakeTimers();
    await warmFillers(quietWarm);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* slow(): AsyncGenerator<Part> {
      yield toolCall('searchKnowledge');
      await gate;
      yield text('Megvan.');
      yield finish;
    }
    agentStreaming(slow());
    const events: VoiceEvent[] = [];

    const turn = runVoiceTurn({
      deps: makeDeps(),
      audio: webmBytes,
      history: [],
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    });
    await vi.advanceTimersByTimeAsync(STILL_SEARCHING_DELAY_MS + 10);
    release();
    await vi.advanceTimersByTimeAsync(10);
    await turn;

    expect(ofType(events, 'filler').map((e) => e.text)).toEqual([
      'Utánanézek a gondozási tudástárban…',
      STILL_SEARCHING_TEXT,
    ]);
  });

  it('should reject when the agent stream fails', async () => {
    agentStreaming(ofParts({ type: 'error', error: new Error('model down') }));

    await expect(runTurn(makeDeps())).rejects.toThrow('model down');
  });

  it('should report each interval in the timing event', async () => {
    agentStreaming(ofParts(text('Szia.'), finish));

    const events = await runTurn(makeDeps());

    const [timing] = ofType(events, 'timing');
    expect(timing?.firstTokenMs).not.toBeNull();
    expect(timing?.firstSentenceMs).not.toBeNull();
  });

  it('should report the first token as its own event, before the sentences', async () => {
    agentStreaming(ofParts(text('Szia. '), text('Hogy vagy?'), finish));

    const events = await runTurn(makeDeps());

    expect(types(events).indexOf('first-token')).toBeGreaterThan(-1);
    expect(types(events).indexOf('first-token')).toBeLessThan(
      types(events).indexOf('sentence'),
    );
    expect(ofType(events, 'first-token')).toHaveLength(1);
  });

  it('should keep the turn alive when one sentence cannot be spoken', async () => {
    agentStreaming(
      ofParts(text('Első. '), text('Rossz mondat. '), text('Harmadik.'), finish),
    );
    const deps = makeDeps();
    deps.speechModel = new MockSpeechModelV2({
      doGenerate: async ({ text: spoken }) => {
        if (spoken.startsWith('Rossz')) {
          throw Object.assign(new Error('TITKOS'), { name: 'AI_APICallError' });
        }
        return {
          audio: new Uint8Array([1]),
          warnings: [],
          response: { timestamp: new Date(), modelId: 'mock', headers: {} },
        };
      },
    });

    const events = await runTurn(deps);

    expect(ofType(events, 'sentence').map((s) => s.index)).toEqual([0, 2]);
    expect(ofType(events, 'speech-failed')).toEqual([
      { type: 'speech-failed', index: 1 },
    ]);
    expect(types(events).slice(-2)).toEqual(['timing', 'done']);
  });
});
