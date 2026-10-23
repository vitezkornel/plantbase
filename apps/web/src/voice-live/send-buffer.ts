// Client events sent before the data channel is open (the history seed is the
// first one) must not vanish: they wait here until a sink is attached.

export interface SendBuffer {
  send(event: object): void;
  attach(sink: (event: object) => void): void;
  close(): void;
}

export function createSendBuffer(): SendBuffer {
  let pending: object[] = [];
  let sink: ((event: object) => void) | null = null;
  let closed = false;

  return {
    send: (event) => {
      if (closed) {
        return;
      }
      if (sink === null) {
        pending.push(event);
        return;
      }
      sink(event);
    },
    attach: (next) => {
      if (closed) {
        return;
      }
      sink = next;
      const queued = pending;
      pending = [];
      for (const event of queued) {
        next(event);
      }
    },
    close: () => {
      closed = true;
      pending = [];
      sink = null;
    },
  };
}
