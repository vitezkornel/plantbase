// packages/core/src/logging/structured-logger.ts
//
// The product code's operational logger (konvenciok.md "Naplózás": no
// `console.*` in product code → a structured logger). One JSON line per
// event — `{ time, level, event, ...fields }` — error/warn to stderr, info
// to stdout. No dependency and no framework: core and apps/web share it.
//
// Not the interaction log: what the agent was asked and answered goes to
// the JSONL interaction log (jsonl-logger.ts), never here. Callers pass an
// event name and the error; an `Error` field is reduced to name, message
// and stack, so properties such as `cause` or a provider error's request
// body never reach the log.

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface StructuredLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Where one finished log line goes; injectable for tests. */
export type LogSink = (level: LogLevel, line: string) => void;

const processSink: LogSink = (level, line) => {
  const stream = level === 'info' ? process.stdout : process.stderr;
  stream.write(line);
};

export function createStructuredLogger(
  sink: LogSink = processSink,
): StructuredLogger {
  const log = (level: LogLevel, event: string, fields: LogFields = {}) =>
    sink(level, formatLine(level, event, fields));

  return {
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  };
}

export const logger: StructuredLogger = createStructuredLogger();

/**
 * Only an `Error`'s name, message and stack — never its other properties.
 * A non-`Error` value is not logged at all (it could be anything, even the
 * user's input), only its type.
 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return {
    name: 'NonError',
    message: `A non-Error value of type ${typeof error} was thrown.`,
  };
}

function formatLine(level: LogLevel, event: string, fields: LogFields): string {
  const entry = {
    time: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(
      // The `error` field is always serialized, even when it is not an
      // Error — an arbitrary thrown value never lands in the log as is.
      Object.entries(fields).map(([key, value]) => [
        key,
        key === 'error' || value instanceof Error
          ? serializeError(value)
          : value,
      ]),
    ),
  };
  try {
    return `${JSON.stringify(entry)}\n`;
  } catch {
    // e.g. a circular field — still record that the event happened.
    return `${JSON.stringify({ time: entry.time, level, event, fieldsDropped: true })}\n`;
  }
}
