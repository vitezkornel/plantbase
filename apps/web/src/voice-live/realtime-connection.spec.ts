import { afterEach, describe, expect, it, vi } from 'vitest';
import { openRealtimeConnection } from './realtime-connection';

class FakeChannel {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: unknown = null;
  readyState = 'connecting';
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 'closed';
  }
}

let channel: FakeChannel;
class FakePeer {
  connectionState = 'new';
  ontrack: unknown = null;
  onconnectionstatechange: unknown = null;
  createDataChannel(): FakeChannel {
    channel = new FakeChannel();
    return channel;
  }
  addTrack(): void {
    /* no-op */
  }
  createOffer(): Promise<{ sdp: string }> {
    return Promise.resolve({ sdp: 'v=0' });
  }
  setLocalDescription(): Promise<void> {
    return Promise.resolve();
  }
  setRemoteDescription(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {
    /* no-op */
  }
}
class FakeAudio {
  autoplay = false;
  srcObject: unknown = null;
}

const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] };

function stubBrowser(getUserMedia: () => Promise<unknown>, fetchOk = true): void {
  vi.stubGlobal('RTCPeerConnection', FakePeer);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: fetchOk,
      status: fetchOk ? 200 : 500,
      text: () => Promise.resolve('answer-sdp'),
    }),
  );
}

const options = () => ({
  clientSecret: 'ek_x',
  model: 'gpt-realtime',
  onEvent: vi.fn(),
  onOpen: vi.fn(),
  onClose: vi.fn(),
});

describe('openRealtimeConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    stopTrack.mockClear();
  });

  it('should reject without calling onClose when the microphone is refused', async () => {
    stubBrowser(() => Promise.reject(new Error('NotAllowedError')));
    const opts = options();

    await expect(openRealtimeConnection(opts)).rejects.toThrow('NotAllowedError');

    expect(opts.onClose).not.toHaveBeenCalled();
  });

  it('should reject without calling onClose when the SDP exchange fails, and release the microphone', async () => {
    stubBrowser(() => Promise.resolve(stream), false);
    const opts = options();

    await expect(openRealtimeConnection(opts)).rejects.toThrow('500');

    expect(opts.onClose).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('should deliver events sent before the channel opened, once it opens', async () => {
    stubBrowser(() => Promise.resolve(stream));
    const opts = options();
    const connection = await openRealtimeConnection(opts);

    connection.send({ n: 1 });
    expect(channel.sent).toEqual([]);
    channel.onopen?.();

    expect(channel.sent).toEqual(['{"n":1}']);
    expect(opts.onOpen).toHaveBeenCalledTimes(1);
  });

  it('should call onClose once and release the microphone after it was open', async () => {
    stubBrowser(() => Promise.resolve(stream));
    const opts = options();
    const connection = await openRealtimeConnection(opts);
    channel.onopen?.();

    connection.close();
    connection.close();

    expect(opts.onClose).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalled();
  });
});
