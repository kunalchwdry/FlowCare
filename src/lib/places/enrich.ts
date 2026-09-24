import 'server-only';
import { placeDetails } from './client';
import { googleMapsConfigured } from '@/lib/env';
import type { ExternalPlaceData } from '@/lib/types';

/**
 * Bounded-concurrency enrichment used by the discovery engine.
 * Returns an empty map when Google is unconfigured — the caller then renders
 * FlowCare-only data instead of failing.
 */
export function makeExternalFetcher(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? googleMapsConfigured();
  return async function fetchExternal(placeIds: string[]): Promise<Map<string, ExternalPlaceData>> {
    const out = new Map<string, ExternalPlaceData>();
    if (!enabled || placeIds.length === 0) return out;

    const unique = [...new Set(placeIds)].slice(0, 12); // hard cap on per-request API cost
    const CONCURRENCY = 4;
    for (let i = 0; i < unique.length; i += CONCURRENCY) {
      const batch = unique.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(batch.map((id) => placeDetails(id, 'core')));
      settled.forEach((res, idx) => {
        if (res.status === 'ok' && res.data) out.set(batch[idx], res.data);
      });
    }
    return out;
  };
}
