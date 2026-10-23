import { describe, expect, it } from 'vitest';
import { createSilenceMeter } from './silence-meter';

describe('createSilenceMeter', () => {
  it('should measure speech stop to the first agent audio', () => {
    const meter = createSilenceMeter();
    meter.speechStopped(1_000);

    expect(meter.agentAudio(1_800)).toEqual({
      sinceSpeechStopMs: 800,
      sinceToolMs: null,
    });
  });

  it('should measure the tool call to the first agent audio separately', () => {
    const meter = createSilenceMeter();
    meter.speechStopped(1_000);
    meter.toolCalled(1_300);

    expect(meter.agentAudio(7_300)).toEqual({
      sinceSpeechStopMs: 6_300,
      sinceToolMs: 6_000,
    });
  });

  it('should disarm after the first agent audio', () => {
    const meter = createSilenceMeter();
    meter.speechStopped(0);
    meter.agentAudio(500);

    expect(meter.agentAudio(900)).toEqual({
      sinceSpeechStopMs: null,
      sinceToolMs: null,
    });
  });

  it('should let the filler end the tool silence while the next agent audio is ignored', () => {
    const meter = createSilenceMeter();
    meter.speechStopped(0);
    meter.toolCalled(100);
    const first = meter.agentAudio(400); // the filler

    expect(first.sinceToolMs).toBe(300);
    expect(meter.agentAudio(7_000).sinceToolMs).toBeNull();
  });

  it('should report the running values for the live counter', () => {
    const meter = createSilenceMeter();
    meter.speechStopped(1_000);
    meter.toolCalled(1_500);

    expect(meter.running(3_000)).toEqual({
      sinceSpeechStopMs: 2_000,
      sinceToolMs: 1_500,
    });
  });

  it('should drop both measurements when the user starts talking again', () => {
    const meter = createSilenceMeter();
    meter.speechStopped(0);
    meter.toolCalled(100);
    meter.speechStarted();

    expect(meter.running(5_000)).toEqual({
      sinceSpeechStopMs: null,
      sinceToolMs: null,
    });
  });

  it('should reset', () => {
    const meter = createSilenceMeter();
    meter.speechStopped(0);
    meter.reset();

    expect(meter.agentAudio(10)).toEqual({
      sinceSpeechStopMs: null,
      sinceToolMs: null,
    });
  });
});
