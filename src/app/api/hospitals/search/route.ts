import { NextRequest } from 'next/server';
import { getRepo } from '@/lib/data';
import { filtersFromSearchParams } from '@/lib/discovery/filters';
import { searchHospitals } from '@/lib/discovery/search';
import { makeExternalFetcher } from '@/lib/places/enrich';
import { buildEvidence } from '@/lib/ai/evidence';
import { filterFingerprint, track } from '@/lib/analytics';
import { handleError, ok, tooMany } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const rl = rateLimit(`search:${clientKey(req)}`, 60);
    if (!rl.allowed) return tooMany('Too many searches. Please wait a moment.', rl.resetInMs);

    const filters = filtersFromSearchParams(req.nextUrl.searchParams);
    const repo = await getRepo();
    const wantExternal = req.nextUrl.searchParams.get('external') !== '0';

    const outcome = await searchHospitals(filters, {
      repo,
      fetchExternal: makeExternalFetcher(),
      skipExternal: !wantExternal,
    });

    const sessionId = req.headers.get('x-flowcare-session') ?? 'anon';
    track('search_performed', sessionId, { ...filterFingerprint(filters), result_count: outcome.total });
    if (outcome.total === 0) track('zero_results', sessionId, filterFingerprint(filters));

    return ok({
      ...outcome,
      results: outcome.results.map((r) => ({ ...r, evidence: buildEvidence(r, filters) })),
      appliedFilters: filters,
    });
  } catch (e) {
    return handleError(e);
  }
}
