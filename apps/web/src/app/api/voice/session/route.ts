import 'server-only';
import { readRealtimeConfig } from '../../../../voice-live/realtime-config';
import { handleSessionRequest } from '../../../../voice-live/session-handler';

export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  return handleSessionRequest(request, () => ({
    config: readRealtimeConfig(),
    fetch,
  }));
}
