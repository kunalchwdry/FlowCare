import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRepo } from '@/lib/data';
import { track } from '@/lib/analytics';
import { fail, handleError, ok, readJson, tooMany } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { TRAVEL_MODES, estimateAllModes } from '@/lib/journey/travel';
import type { TravelMode } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    hospitalId: z.string().min(1).max(120),
    origin: z.object({
      lat: z.number().gte(-90).lte(90),
      lng: z.number().gte(-180).lte(180),
    }),
    modes: z.array(z.enum(['walk', 'transit', 'drive'])).min(1).max(3).optional(),
  })
  .strict();

/**
 * F6 — journey time per mode.
 *
 * POST rather than GET because the body carries the user's origin
 * coordinates, which must not land in a URL, a referrer header or an access
 * log. The response is no-store: Google Maps Service Terms forbid caching
 * route results, and a stale journey time is worse than none.
 */
export async function POST(req: NextRequest) {
  try {
    const limit = rateLimit(`travel:${clientKey(req)}`, 30);
    if (!limit.allowed) return tooMany('Too many journey lookups. Please wait a moment.', limit.resetInMs);

    const { hospitalId, origin, modes } = Body.parse(await readJson(req, 2000));

    const repo = await getRepo();
    const hospital = await repo.getHospital(hospitalId);
    if (!hospital) return fail(404, 'Hospital not found');

    const requested = (modes ?? TRAVEL_MODES) as TravelMode[];
    const estimates = await estimateAllModes(origin, hospital.location, requested);

    // Only that a lookup happened, and at what coarse outcome. No coordinates.
    track('travel_estimated', req.headers.get('x-flowcare-session') ?? 'anon', {
      hospital_id: hospital.id,
      mode_count: requested.length,
      routed: estimates.some((e) => e.basis === 'routing'),
    });

    return ok(
      { hospitalId: hospital.id, estimates },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return handleError(e);
  }
}
