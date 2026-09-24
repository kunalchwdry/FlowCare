import { NextRequest } from 'next/server';
import { z } from 'zod';
import { aggregates, track, type DiscoveryEventName } from '@/lib/analytics';
import { getSession } from '@/lib/auth/session';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAMES: DiscoveryEventName[] = [
  'search_performed', 'filters_applied', 'hospital_viewed', 'map_opened', 'list_opened',
  'view_toggled', 'comparison_opened', 'favorite_added', 'favorite_removed',
  'assistant_query', 'booking_initiated', 'booking_completed', 'zero_results',
];

/** Only scalar props are accepted; free text is rejected outright. */
const Body = z.object({
  name: z.enum(NAMES as [DiscoveryEventName, ...DiscoveryEventName[]]),
  sessionId: z.string().min(1).max(64),
  props: z.record(z.union([z.string().max(64), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`analytics:${clientKey(req)}`, 120);
    if (!rl.allowed) return ok({ recorded: false });
    const body = Body.parse(await readJson(req, 2000));
    track(body.name, body.sessionId, body.props ?? {});
    return ok({ recorded: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function GET() {
  try {
    const user = await getSession();
    if (!user || user.role !== 'admin') return fail(403, 'Analytics are restricted to FlowCare administrators.');
    return ok(aggregates());
  } catch (e) {
    return handleError(e);
  }
}
