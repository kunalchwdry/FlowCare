import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { loadHospitalDetail } from '@/lib/discovery/search';
import { makeExternalFetcher } from '@/lib/places/enrich';
import { haversineKm } from '@/lib/discovery/geo';
import { track } from '@/lib/analytics';
import { fail, handleError, ok } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_COMPARE = 4;

export async function GET(req: NextRequest) {
  try {
    const ids = (req.nextUrl.searchParams.get('ids') ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_COMPARE);
    if (ids.length < 2) return fail(400, `Select between 2 and ${MAX_COMPARE} hospitals to compare.`);

    const lat = Number(req.nextUrl.searchParams.get('lat'));
    const lng = Number(req.nextUrl.searchParams.get('lng'));
    const origin = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

    const repo = await getRepo();
    const fetchExternal = makeExternalFetcher();
    const details = await Promise.all(ids.map((id) => loadHospitalDetail(id, { repo, fetchExternal })));
    const found = details.filter((d): d is NonNullable<typeof d> => d !== null);
    if (found.length < 2) return fail(404, 'Not enough of those hospitals could be found.');

    track('comparison_opened', req.headers.get('x-flowcare-session') ?? 'anon', { count: found.length });

    return ok({
      hospitals: found.map((d) => ({
        ...d,
        distanceKm: origin ? Number(haversineKm(origin, d.hospital.location).toFixed(2)) : null,
      })),
      disclaimer:
        'This table shows the data FlowCare holds side by side. FlowCare does not rank hospitals or identify a "best" option, and none of these figures are a measure of clinical quality.',
    });
  } catch (e) {
    return handleError(e);
  }
}
