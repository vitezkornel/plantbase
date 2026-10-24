// The only file that touches WebRTC. Flow (OpenAI docs): the browser opens a
// peer connection with the ephemeral key, sends its SDP offer to /v1/realtime/calls,
// and talks over the `oai-events` data channel. close() must release the
// microphone, the peer and the audio element — leaving the page calls it.

import { isRealtimeEvent, type RealtimeEvent } from './realtime-events';
import { createSendBuffer } from './send-buffer';

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const DATA_CHANNEL_NAME = 'oai-events';

export interface RealtimeConnection {
  send(event: object): void;
  close(): void;
}

export interface OpenOptions {
  clientSecret: string;
  model: string;
  onEvent(event: RealtimeEvent): void;
  onOpen(): void;
  onClose(): void;
}

export async function openRealtimeConnection({
  clientSecret,
  model,
  onEvent,
  onOpen,
  onClose,
}: OpenOptions): Promise<RealtimeConnection> {
  const peer = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  peer.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? null;
  };

  // Events sent before the channel is open (the history seed) wait here.
  const outbox = createSendBuffer();
  let microphone: MediaStream | undefined;
  let opened = false;
  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    outbox.close();
    channel.close();
    peer.close();
    microphone?.getTracks().forEach((track) => track.stop());
    audio.srcObject = null;
    // A failed setup is reported by the rejected promise; onClose is for a
    // connection that was up, so the caller does not swallow the error.
    if (opened) {
      onClose();
    }
  };

  const channel = peer.createDataChannel(DATA_CHANNEL_NAME);
  channel.onopen = () => {
    opened = true;
    outbox.attach((event) => channel.send(JSON.stringify(event)));
    onOpen();
  };
  channel.onclose = close;
  channel.onmessage = (message: MessageEvent<string>) => {
    try {
      const parsed: unknown = JSON.parse(message.data);
      if (isRealtimeEvent(parsed)) {
        onEvent(parsed);
      }
    } catch {
      // not JSON: ignore
    }
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
      close();
    }
  };

  try {
    microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of microphone.getTracks()) {
      peer.addTrack(track, microphone);
    }
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    // `model` is repeated in the query, as in the instructor's working demo;
    // whether it is required with an ephemeral key is checked in the live run.
    const response = await fetch(
      `${CALLS_URL}?model=${encodeURIComponent(model)}`,
      {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Realtime SDP exchange failed (${response.status})`);
    }
    await peer.setRemoteDescription({
      type: 'answer',
      sdp: await response.text(),
    });
  } catch (error: unknown) {
    close();
    throw error;
  }

  return { send: outbox.send, close };
}
