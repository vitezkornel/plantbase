import 'server-only';
import { handleSupervisorRequest } from '../../../../voice-live/supervisor-handler';

// The ask-agent needs Node (pg, fs logging).
export const runtime = 'nodejs';

export function POST(request: Request): Promise<Response> {
  return handleSupervisorRequest(request);
}
