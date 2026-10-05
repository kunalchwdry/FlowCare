/**
 * The FlowCare Hospital Discovery Engine.
 *
 * Authoritative order of operations:
 *   1. Load FlowCare hospitals (our own verified records).
 *   2. Apply validated filters (never raw user text into a query builder).
 *   3. Compute availability from FlowCare sessions only.
 *   4. Aggregate FlowCare verified-visit ratings (shrinkage model).
 *   5. OPTIONALLY enrich with Google Places data for linked hospitals.
 *   6. Score a transparent preference match.
 *
 * Google data can never create, remove or rename a hospital in the results —
 * it only annotates a FlowCare record that an administrator explicitly linked.
 */
import type {
  DiscoveryResult, ExternalPlaceData, Hospital, HospitalAvailability,
} from '@/lib/types';
import type { Repo } from '@/lib/data/repo';
import type { DiscoveryFilters } from './filters';
import { computeAvailability, specialtyAvailable } from './availability';
import { aggregateAll } from './rating';
import { anchorForCity, haversineKm } from './geo';
import { computeMatch, type MatchPreference } from './match';

/**
 * Upper bound on how many candidates we will enrich when a Google-rating
 * filter or sort forces whole-set enrichment. Places Details is billed per
 * call, so this caps the cost of one search; beyond it the filter is reported
 * as only partially enforceable.
 */
const GOOGLE_WIDE_ENRICH_CAP = 60;

export interface SearchOutcome {
  results: DiscoveryResult[];
  total: number;
  page: number;
  pageSize: number;
  /** Set when the user's text query matched nothing and we relaxed a filter. */
  relaxedFilters: string[];
  /**
   * Filters that were requested but could NOT be fully applied (e.g. a Google
   * rating floor while Google is unconfigured). Surfaced to the UI so we never
   * display a filter as active when it did not actually constrain anything.
   */
  unenforceableFilters: string[];
  /** Why zero results, in plain language. */
  emptyReason: string | null;
  /** Whether external enrichment ran, and why not if it didn't. */
  externalStatus: 'ok' | 'not_configured' | 'partial' | 'skipped';
  computedAt: string;
}

export interface SearchDeps {
  repo: Repo;
  /** Injected so tests can run without network and so route handlers control cost. */
  fetchExternal?: (placeIds: string[]) => Promise<Map<string, ExternalPlaceData>>;
  now?: Date;
  preference?: MatchPreference;
  /** Skip Places enrichment entirely (e.g. list view, cost control). */
  skipExternal?: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '');

function textMatches(h: Hospital, q: string): boolean {
  const needle = norm(q);
  if (!needle) return true;
  const hay = norm(
    [h.name, h.addressLine, h.city, h.state, h.type, h.description ?? '',
     ...h.departments.map((d) => d.name), ...h.departments.map((d) => d.specialty),
     ...h.services.map((s) => s.name)].join(' '),
  );
  return needle.split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
}

function openNow(h: Hospital, now: Date): boolean {
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  const spec = h.operatingHours[day];
  if (!spec) return false;
  if (/24 hours/i.test(spec)) return true;
  if (/closed/i.test(spec)) return false;
  const m = spec.match(/(\d{2}):(\d{2})\D+(\d{2}):(\d{2})/);
  if (!m) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  return mins >= start && mins <= end;
}

export async function searchHospitals(
  filters: DiscoveryFilters,
  deps: SearchDeps,
): Promise<SearchOutcome> {
  const now = deps.now ?? new Date();
  const { repo } = deps;

  const [hospitals, sessions, reviews] = await Promise.all([
    repo.listHospitals(),
    repo.listSessions(),
    repo.listReviews({ includeNonPublished: false }),
  ]);

  const ratings = aggregateAll(hospitals.map((h) => h.id), reviews, now);
  const availabilityById = new Map<string, HospitalAvailability>(
    hospitals.map((h) => [h.id, computeAvailability(h.id, sessions, now)]),
  );

  const origin = filters.near ?? anchorForCity(filters.city) ?? null;

  // ---- filtering --------------------------------------------------------
  const relaxedFilters: string[] = [];
  let candidates = hospitals.filter((h) => {
    if (filters.q && !textMatches(h, filters.q)) return false;
    if (filters.city && norm(h.city) !== norm(filters.city)) return false;
    if (filters.area && !norm(h.addressLine).includes(norm(filters.area))) return false;
    if (filters.hospitalTypes?.length && !filters.hospitalTypes.includes(h.type)) return false;
    if (filters.flowcareVerifiedOnly && !h.flowcareVerified) return false;
    if (filters.emergencyServices && !h.emergencyServices) return false;

    if (filters.specialties?.length) {
      const have = new Set(h.departments.filter((d) => d.active).map((d) => d.specialty));
      if (!filters.specialties.some((s) => have.has(s))) return false;
    }
    if (filters.services?.length) {
      const have = new Set(h.services.map((s) => s.slug));
      if (!filters.services.every((s) => have.has(s))) return false;
    }
    if (filters.accessibility?.length) {
      const have = new Set(h.accessibility);
      if (!filters.accessibility.every((a) => have.has(a))) return false;
    }
    if (filters.languages?.length) {
      const have = new Set(h.languages);
      if (!filters.languages.some((l) => have.has(l))) return false;
    }
    if (filters.openNow && !openNow(h, now)) return false;

    if (origin && filters.radiusKm) {
      if (haversineKm(origin, h.location) > filters.radiusKm) return false;
    }

    const avail = availabilityById.get(h.id)!;
    if (filters.availability?.length && !filters.availability.includes(avail.state)) return false;
    if (filters.availableWithinDays) {
      if (!avail.nextAvailableDate) return false;
      const limit = new Date(now.getTime() + filters.availableWithinDays * 86_400_000).toISOString().slice(0, 10);
      if (avail.nextAvailableDate > limit) return false;
      // Specialty-specific availability where the user asked for a specialty.
      if (filters.specialties?.length && !filters.specialties.some((s) => specialtyAvailable(avail, s))) return false;
    }

    const rating = ratings[h.id];
    if (filters.minFlowcareRating !== undefined) {
      if (rating.score === null || rating.score < filters.minFlowcareRating) return false;
    }
    if (filters.minReviewCount !== undefined && rating.reviewCount < filters.minReviewCount) return false;

    return true;
  });

  // Google rating is a *post-enrichment* filter; applied later only when data exists.

  // ---- distance ---------------------------------------------------------
  const withDistance = candidates.map((h) => ({
    hospital: h,
    distanceKm: origin ? Number(haversineKm(origin, h.location).toFixed(2)) : null,
  }));

  // ---- sorting ----------------------------------------------------------
  const sorted = withDistance.slice().sort((a, b) => {
    const ra = ratings[a.hospital.id];
    const rb = ratings[b.hospital.id];
    const aa = availabilityById.get(a.hospital.id)!;
    const ab = availabilityById.get(b.hospital.id)!;
    const availRank = (s: string) => (s === 'available' ? 0 : s === 'limited' ? 1 : s === 'unknown' ? 2 : 3);

    switch (filters.sort) {
      case 'distance':
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      case 'flowcare_rating':
        return (rb.score ?? -1) - (ra.score ?? -1);
      case 'review_count':
        return rb.reviewCount - ra.reviewCount;
      case 'availability':
        return availRank(aa.state) - availRank(ab.state);
      case 'name':
        return a.hospital.name.localeCompare(b.hospital.name);
      case 'google_rating':
        return 0; // resolved after enrichment
      case 'relevance':
      default: {
        // Relevance = availability first, then distance when we have an origin,
        // then review volume. Deliberately NOT a quality ranking.
        const ar = availRank(aa.state) - availRank(ab.state);
        if (ar !== 0) return ar;
        if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
        return rb.reviewCount - ra.reviewCount;
      }
    }
  });

  // ---- external enrichment ---------------------------------------------
  //
  // Normally we enrich only the page slice, so a list view costs at most
  // pageSize Place Details calls. But a Google-rating filter or sort cannot be
  // honestly applied to one page: it has to see every candidate. When the user
  // asks for one, we widen enrichment to the whole candidate set up to a hard
  // cap. If we cannot get the data at all, the filter is reported as
  // unenforceable rather than being silently ignored.
  const needsWideGoogle =
    filters.minGoogleRating !== undefined || filters.sort === 'google_rating';
  const canFetchExternal = !deps.skipExternal && Boolean(deps.fetchExternal);

  const unenforceableFilters: string[] = [];
  let externalStatus: SearchOutcome['externalStatus'] = 'skipped';
  let externalMap = new Map<string, ExternalPlaceData>();

  const placeIdsOf = (items: typeof sorted) =>
    items
      .map((p) => p.hospital.placeLink)
      .filter((l): l is NonNullable<typeof l> => Boolean(l && l.placeId && l.matchMethod !== 'unlinked'))
      .map((l) => l.placeId);

  const start = (filters.page - 1) * filters.pageSize;
  const wideSlice = needsWideGoogle ? sorted.slice(0, GOOGLE_WIDE_ENRICH_CAP) : [];
  const pageSlice = sorted.slice(start, start + filters.pageSize);
  const toEnrich = needsWideGoogle ? wideSlice : pageSlice;
  const linkedIds = Array.from(new Set(placeIdsOf(toEnrich)));

  if (canFetchExternal && linkedIds.length) {
    try {
      externalMap = await deps.fetchExternal!(linkedIds);
      externalStatus = externalMap.size === 0 ? 'not_configured'
        : externalMap.size < linkedIds.length ? 'partial' : 'ok';
    } catch {
      externalStatus = 'partial';
    }
  } else if (!canFetchExternal) {
    externalStatus = deps.skipExternal ? 'skipped' : 'not_configured';
  }

  const googleRatingOf = (h: Hospital): number | null => {
    const link = h.placeLink;
    if (!link || link.matchMethod === 'unlinked' || !link.placeId) return null;
    const d = externalMap.get(link.placeId);
    return d?.rating ?? null;
  };

  // Apply the Google-rating filter to the whole candidate set, not the page.
  let ordered = sorted;
  if (filters.minGoogleRating !== undefined) {
    if (externalMap.size === 0) {
      // No Google data at all -> the filter genuinely cannot be enforced.
      // Returning unfiltered results here would be claiming a rating floor we
      // never checked, so we return nothing and say why.
      unenforceableFilters.push('minGoogleRating');
      ordered = [];
    } else {
      if (sorted.length > GOOGLE_WIDE_ENRICH_CAP) unenforceableFilters.push('minGoogleRating:truncated');
      ordered = wideSlice.filter((p) => (googleRatingOf(p.hospital) ?? -1) >= filters.minGoogleRating!);
    }
  }

  if (filters.sort === 'google_rating') {
    if (externalMap.size === 0) {
      unenforceableFilters.push('sort:google_rating');
    } else {
      ordered = ordered
        .slice()
        .sort((a, b) => (googleRatingOf(b.hospital) ?? -1) - (googleRatingOf(a.hospital) ?? -1));
    }
  }

  const total = ordered.length;
  const pageItems = needsWideGoogle
    ? ordered.slice(start, start + filters.pageSize)
    : pageSlice;

  const results: DiscoveryResult[] = pageItems.map(({ hospital, distanceKm }) => {
    const link = hospital.placeLink;
    const placeId = link && link.matchMethod !== 'unlinked' ? link.placeId : null;
    const data = placeId ? externalMap.get(placeId) ?? null : null;
    const base = {
      hospital,
      distanceKm,
      availability: availabilityById.get(hospital.id)!,
      // Legacy published queue snapshots are not Patient Traffic and are
      // intentionally not included in public discovery responses.
      queue: null,
      flowcareRating: ratings[hospital.id],
      external: {
        linked: Boolean(placeId),
        placeId,
        data,
        status: (!placeId ? 'not_linked'
          : data ? 'ok'
          : externalStatus === 'not_configured' || externalStatus === 'skipped' ? 'not_configured'
          : 'error') as DiscoveryResult['external']['status'],
      },
    };
    return { ...base, match: computeMatch(base, filters, deps.preference) };
  });

  const emptyReason = total === 0
    ? (unenforceableFilters.includes('minGoogleRating')
        ? 'Google ratings are not available on this deployment, so a minimum Google rating cannot be applied. Remove that filter to see FlowCare results.'
        : explainEmpty(filters))
    : null;

  return {
    results,
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    relaxedFilters,
    unenforceableFilters,
    emptyReason,
    externalStatus,
    computedAt: now.toISOString(),
  };
}

function explainEmpty(f: DiscoveryFilters): string {
  const bits: string[] = [];
  if (f.specialties?.length) bits.push(`department: ${f.specialties.join(', ')}`);
  if (f.city) bits.push(`city: ${f.city}`);
  if (f.radiusKm) bits.push(`within ${f.radiusKm} km`);
  if (f.availableWithinDays) bits.push(`a free slot in ${f.availableWithinDays} day(s)`);
  if (f.minFlowcareRating) bits.push(`FlowCare rating ≥ ${f.minFlowcareRating}`);
  if (f.minReviewCount) bits.push(`≥ ${f.minReviewCount} reviews`);
  if (f.accessibility?.length) bits.push(`accessibility: ${f.accessibility.join(', ')}`);
  return bits.length
    ? `No FlowCare hospitals matched ${bits.join(' · ')}. Try widening the distance or removing a filter.`
    : 'No FlowCare hospitals matched this search.';
}

/** Loads one hospital with the same derived data the list uses. */
export async function loadHospitalDetail(
  idOrSlug: string,
  deps: SearchDeps,
): Promise<Omit<DiscoveryResult, 'match'> | null> {
  const now = deps.now ?? new Date();
  const hospital = await deps.repo.getHospital(idOrSlug);
  if (!hospital) return null;

  const [sessions, reviews, traffic] = await Promise.all([
    deps.repo.listSessions([hospital.id]),
    deps.repo.listReviews({ includeNonPublished: false }),
    deps.repo.listPatientTraffic([hospital.id]),
  ]);

  const ratings = aggregateAll([hospital.id], reviews, now);
  const link = hospital.placeLink;
  const placeId = link && link.matchMethod !== 'unlinked' ? link.placeId : null;

  let data: ExternalPlaceData | null = null;
  let status: DiscoveryResult['external']['status'] = placeId ? 'not_configured' : 'not_linked';
  if (placeId && deps.fetchExternal && !deps.skipExternal) {
    try {
      const m = await deps.fetchExternal([placeId]);
      data = m.get(placeId) ?? null;
      status = data ? 'ok' : 'error';
    } catch {
      status = 'error';
    }
  }

  return {
    hospital,
    distanceKm: null,
    availability: computeAvailability(hospital.id, sessions, now),
    queue: null,
    traffic: traffic[0] ?? undefined,
    flowcareRating: ratings[hospital.id],
    external: { linked: Boolean(placeId), placeId, data, status },
  };
}
