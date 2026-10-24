import { describe, expect, it } from 'vitest';
import {
  agentTranscriptOf,
  errorMessageOf,
  functionCallOf,
  isAgentAudioStart,
  isRealtimeEvent,
  userTranscriptOf,
} from './realtime-events';

describe('isRealtimeEvent', () => {
  it('should accept objects with a string type', () => {
    expect(isRealtimeEvent({ type: 'session.created' })).toBe(true);
  });

  it.each([null, undefined, 'x', 3, [], {}, { type: 1 }])(
    'should reject %j',
    (value) => {
      expect(isRealtimeEvent(value)).toBe(false);
    },
  );
});

describe('event accessors', () => {
  it('should read the user transcript', () => {
    expect(
      userTranscriptOf({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: ' szia ',
      }),
    ).toBe('szia');
    expect(userTranscriptOf({ type: 'other', transcript: 'x' })).toBeNull();
    expect(
      userTranscriptOf({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: '  ',
      }),
    ).toBeNull();
  });

  it('should read the agent transcript', () => {
    expect(
      agentTranscriptOf({
        type: 'response.output_audio_transcript.done',
        transcript: 'Üdv!',
      }),
    ).toBe('Üdv!');
    expect(agentTranscriptOf({ type: 'other' })).toBeNull();
  });

  it('should recognise the first agent audio signals', () => {
    expect(isAgentAudioStart({ type: 'output_audio_buffer.started' })).toBe(
      true,
    );
    expect(
      isAgentAudioStart({ type: 'response.output_audio_transcript.delta' }),
    ).toBe(true);
    expect(isAgentAudioStart({ type: 'response.done' })).toBe(false);
  });

  it('should read a function call', () => {
    expect(
      functionCallOf({
        type: 'response.function_call_arguments.done',
        call_id: 'c1',
        name: 'askPlantbase',
        arguments: '{"question":"k"}',
      }),
    ).toEqual({
      callId: 'c1',
      name: 'askPlantbase',
      rawArguments: '{"question":"k"}',
    });
    expect(
      functionCallOf({ type: 'response.function_call_arguments.done' }),
    ).toBeNull();
    expect(functionCallOf({ type: 'other' })).toBeNull();
  });

  it('should read an error message with a safe fallback', () => {
    expect(errorMessageOf({ type: 'error', error: { message: 'boom' } })).toBe(
      'boom',
    );
    expect(errorMessageOf({ type: 'error' })).toBe('Ismeretlen hiba.');
  });
});
