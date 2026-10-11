import { describe, expect, it } from 'vitest';
import {
  createStructuredLogger,
  serializeError,
  type LogLevel,
} from './structured-logger.js';

function captureLogger() {
  const lines: { level: LogLevel; line: string }[] = [];
  const logger = createStructuredLogger((level, line) =>
    lines.push({ level, line }),
  );
  const entries = () =>
    lines.map(({ line }) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, entries };
}

describe('createStructuredLogger', () => {
  it('should write one JSON line with time, level, event and the fields', () => {
    const { logger, lines, entries } = captureLogger();

    logger.info('app.started', { port: 3001 });

    expect(lines).toHaveLength(1);
    expect(lines[0].line.endsWith('\n')).toBe(true);
    expect(lines[0].line.trimEnd()).not.toContain('\n');
    expect(entries()[0]).toEqual({
      time: expect.any(String),
      level: 'info',
      event: 'app.started',
      port: 3001,
    });
  });

  it('should pass the level to the sink for each log method', () => {
    const { logger, lines } = captureLogger();

    logger.info('a');
    logger.warn('b');
    logger.error('c');

    expect(lines.map(({ level }) => level)).toEqual(['info', 'warn', 'error']);
  });

  it('should reduce an Error field to name, message and stack only', () => {
    const { logger, entries } = captureLogger();
    const error = Object.assign(
      new Error('model overloaded', {
        cause: new Error('secret cause'),
      }),
      { requestBodyValues: { messages: 'the user question' } },
    );

    logger.error('stream.failed', { error });

    const logged = entries()[0].error as Record<string, unknown>;
    expect(Object.keys(logged).sort()).toEqual(['message', 'name', 'stack']);
    expect(logged.message).toBe('model overloaded');
    expect(JSON.stringify(entries()[0])).not.toContain('the user question');
    expect(JSON.stringify(entries()[0])).not.toContain('secret cause');
  });

  it('should never log a non-Error value passed as the error field', () => {
    const { logger, entries } = captureLogger();

    logger.error('stream.failed', { error: 'Mi a kedvenc növényed?' });

    expect(entries()[0].error).toEqual({
      name: 'NonError',
      message: 'A non-Error value of type string was thrown.',
    });
  });

  it('should still record the event when a field cannot be serialized', () => {
    const { logger, entries } = captureLogger();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.warn('odd.input', { circular });

    expect(entries()[0]).toEqual({
      time: expect.any(String),
      level: 'warn',
      event: 'odd.input',
      fieldsDropped: true,
    });
  });
});

describe('serializeError', () => {
  it('should keep the name of an Error subclass', () => {
    expect(serializeError(new TypeError('bad')).name).toBe('TypeError');
  });
});
