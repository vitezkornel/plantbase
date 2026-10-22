import 'server-only';
import { readVoiceConfig } from '../../../voice/voice-config';
import { handleVoiceRequest } from '../../../voice/voice-handler';
import { createVoiceDeps } from '../../../voice/voice-providers';

// The voice pipeline needs Node (Buffer, the ask-agent's pg and fs logging).
export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  return handleVoiceRequest(request, () => createVoiceDeps(readVoiceConfig()));
}
