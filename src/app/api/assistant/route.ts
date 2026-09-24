import { NextRequest } from 'next/server';
import { z } from 'zod';
import { EMERGENCY_NOTICE, SCOPE_NOTICE } from '@/lib/ai/notices';
import { getRepo } from '@/lib/data';
import { extractIntent } from '@/lib/ai/intent';
import { getProvider, listProviders } from '@/lib/ai/providers';
import { DiscoveryFiltersSchema, type DiscoveryFilters } from '@/lib/discovery/filters';
import { searchHospitals } from '@/lib/discovery/search';
import { makeExternalFetcher } from '@/lib/places/enrich';
import { buildEvidence } from '@/lib/ai/evidence';
import { anchorForCity } from '@/lib/discovery/geo';
import { env } from '@/lib/env';
import { track } from '@/lib/analytics';
import { fail, handleError, ok, readJson } from '@/lib/http';
import { clientKey, rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  query: z.string().min(1).max(400),
  provider: z.string().max(40).nullish(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
  page: z.number().int().min(1).max(50).optional(),
}).strict();


export async function POST(req: NextRequest) {
  try {
    const body = Body.parse(await readJson(req, 4000));

    const rl = rateLimit(`assistant:${clientKey(req)}`, env.aiRateLimitPerMin());
    if (!rl.allowed) {
      return fail(429, 'You have made a lot of assistant requests. Please wait a minute, or use the filters on /hospitals.', {
        retryInMs: rl.resetInMs,
      });
    }

    // Reject an unknown / unconfigured provider explicitly rather than
    // silently swapping to another vendor.
    const known = listProviders();
    if (body.provider && !known.some((p) => p.id === body.provider)) {
      return fail(400, 'Unknown AI provider.');
    }
    const provider = getProvider(body.provider ?? null);

    const intent = await extractIntent(body.query, {
      provider,
      timeoutMs: env.aiTimeoutMs(),
      maxChars: env.aiMaxInputChars(),
    });

    // --- Map validated AI filters onto the discovery filter schema ---------
    const { useUserLocation, preference, ...rest } = intent.filters;
    const draft: Record<string, unknown> = { ...rest };
    if (useUserLocation && body.location) {
      draft.near = body.location;
      draft.radiusKm = intent.filters.radiusKm ?? 10;
    } else if (useUserLocation && !body.location) {
      const anchor = anchorForCity(intent.filters.city);
      if (anchor) { draft.near = anchor; draft.radiusKm = intent.filters.radiusKm ?? 10; }
    }
    draft.page = body.page ?? 1;
    draft.pageSize = 8;
    draft.sort = 'relevance';

    const filters: DiscoveryFilters = DiscoveryFiltersSchema.parse(draft);

    const repo = await getRepo();
    const outcome = await searchHospitals(filters, {
      repo,
      fetchExternal: makeExternalFetcher(),
      preference,
    });

    track('assistant_query', req.headers.get('x-flowcare-session') ?? 'anon', {
      provider: intent.provider ?? 'none',
      source: intent.source,
      result_count: outcome.total,
      query_length: body.query.length,
      used_location: Boolean(draft.near),
    });

    const locationNotice =
      useUserLocation && !body.location && !draft.near
        ? 'You asked for hospitals near you but location access is not available. Showing results without a distance filter — you can search by city or area instead.'
        : null;

    return ok({
      // Everything below is derived from retrieved data, never model prose.
      understood: {
        filters,
        explanation: intent.notes,
        source: intent.source,
        provider: intent.provider,
        model: intent.model,
        latencyMs: intent.latencyMs,
      },
      aiUnavailableReason: intent.aiUnavailableReason,
      safetyNotice: intent.emergencySignal ? EMERGENCY_NOTICE : null,
      scopeNotice: SCOPE_NOTICE,
      locationNotice,
      results: outcome.results.map((r) => ({ ...r, evidence: buildEvidence(r, filters) })),
      total: outcome.total,
      emptyReason: outcome.emptyReason,
      computedAt: outcome.computedAt,
    });
  } catch (e) {
    return handleError(e);
  }
}
