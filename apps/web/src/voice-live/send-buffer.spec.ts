import { describe, expect, it } from 'vitest';
import { createSendBuffer } from './send-buffer';

describe('createSendBuffer', () => {
  it('should hold events until a sink is attached, then flush them in order', () => {
    const buffer = createSendBuffer();
    const seen: object[] = [];
    buffer.send({ n: 1 });
    buffer.send({ n: 2 });
    expect(seen).toEqual([]);

    buffer.attach((event) => seen.push(event));

    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('should pass events straight through once attached', () => {
    const buffer = createSendBuffer();
    const seen: object[] = [];
    buffer.attach((event) => seen.push(event));
    buffer.send({ n: 3 });
    expect(seen).toEqual([{ n: 3 }]);
  });

  it('should drop events after close', () => {
    const buffer = createSendBuffer();
    const seen: object[] = [];
    buffer.attach((event) => seen.push(event));
    buffer.close();
    buffer.send({ n: 4 });
    expect(seen).toEqual([]);
  });

  it('should not flush buffered events into a sink attached after close', () => {
    const buffer = createSendBuffer();
    const seen: object[] = [];
    buffer.send({ n: 1 });
    buffer.close();
    buffer.attach((event) => seen.push(event));
    expect(seen).toEqual([]);
  });
});
