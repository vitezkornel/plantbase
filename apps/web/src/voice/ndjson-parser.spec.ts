import { describe, expect, it } from 'vitest';
import { createNdjsonParser } from './ndjson-parser';

describe('createNdjsonParser', () => {
  it('should parse complete lines', () => {
    const parser = createNdjsonParser();

    expect(parser.push('{"type":"done"}\n{"type":"escalated"}\n')).toEqual([
      { type: 'done' },
      { type: 'escalated' },
    ]);
  });

  it('should hold a line split across chunks until it is complete', () => {
    const parser = createNdjsonParser();

    expect(parser.push('{"type":"tran')).toEqual([]);
    expect(parser.push('script","text":"szia","sttMs":5}\n')).toEqual([
      { type: 'transcript', text: 'szia', sttMs: 5 },
    ]);
  });

  it('should skip blank lines, malformed JSON and unknown event types', () => {
    const parser = createNdjsonParser();

    expect(
      parser.push('\nnot json\n{"type":"nope"}\n{"type":"done"}\n'),
    ).toEqual([{ type: 'done' }]);
  });
});
