/**
 * Privacy-conscious discovery analytics.
 *
 * What we record: the *shape* of a search (which filter keys were used, how
 * many results came back, which surface was used).
 * What we never record: free-text queries with identifying content, precise
 * coordinates, any clinical information, or a durable per-user profile.
 */
import type { DiscoveryFilters } from '@/lib/discovery/filters';
import { coarsen } from '@/lib/discovery/geo';

export type DiscoveryEventName =
  | 'search_performed'
  | 'filters_applied'
  | 'hospital_viewed'
  | 'map_opened'
  | 'list_opened'
  | 'view_toggled'
  | 'comparison_opened'
  | 'favorite_added'
  | 'favorite_removed'
  | 'assistant_query'
  | 'booking_initiated'
  | 'booking_completed'
  | 'zero_results'
  /* journey layer. NOTE: care-context ids, visit records and follow-up tasks
   * are never emitted as analytics props (§9.1) — only that an interaction
   * happened, plus a hospital id where the surface is public anyway. */
  | 'care_need_translated'
  | 'facility_facts_viewed'
  | 'prep_checklist_viewed'
  | 'visit_card_generated'
  | 'correction_submitted'
  | 'correction_reviewed'
  | 'travel_estimated'
  | 'accessibility_detail_viewed';

export interface DiscoveryEvent {
  name: DiscoveryEventName;
  at: string;
  /** Rotating per-session id, not a user id. */
  sessionId: string;
  props: Record<string, string | number | boolean | null>;
}

const events: DiscoveryEvent[] = [];
const MAX_EVENTS = 5000;

/** Only these keys are ever recorded, and only as booleans/counts. */
export function filterFingerprint(f: Partial<DiscoveryFilters>): Record<string, string | number | boolean> {
  return {
    has_query: Boolean(f.q),
    query_length: f.q ? Math.min(f.q.length, 120) : 0,
    specialties: f.specialties?.length ?? 0,
    services: f.services?.length ?? 0,
    types: f.hospitalTypes?.length ?? 0,
    accessibility: f.accessibility?.length ?? 0,
    languages: f.languages?.length ?? 0,
    has_city: Boolean(f.city),
    has_location: Boolean(f.near),
    radius_km: f.radiusKm ?? 0,
    availability: f.availability?.length ?? 0,
    within_days: f.availableWithinDays ?? 0,
    min_fc_rating: f.minFlowcareRating ?? 0,
    min_google_rating: f.minGoogleRating ?? 0,
    min_reviews: f.minReviewCount ?? 0,
    open_now: Boolean(f.openNow),
    sort: f.sort ?? 'relevance',
    page: f.page ?? 1,
  };
}

export function track(name: DiscoveryEventName, sessionId: string, props: DiscoveryEvent['props'] = {}) {
  events.push({ name, at: new Date().toISOString(), sessionId, props });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Coarsened location, for "which areas have no coverage" style questions. */
export function locationBucket(p: { lat: number; lng: number } | undefined): string | null {
  if (!p) return null;
  const c = coarsen(p, 1); // ~11 km grid for analytics
  return `${c.lat.toFixed(1)},${c.lng.toFixed(1)}`;
}

export function snapshot(): DiscoveryEvent[] {
  return events.slice();
}

/** Aggregates that answer the product questions in the brief. */
export function aggregates() {
  const byName = new Map<string, number>();
  let zero = 0;
  let searches = 0;
  const filterUse = new Map<string, number>();
  const viewed = new Map<string, number>();
  const booked = new Map<string, number>();

  for (const e of events) {
    byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
    if (e.name === 'search_performed') {
      searches += 1;
      if (e.props.result_count === 0) zero += 1;
      for (const [k, v] of Object.entries(e.props)) {
        if (typeof v === 'number' && v > 0 && k !== 'result_count' && k !== 'page') {
          filterUse.set(k, (filterUse.get(k) ?? 0) + 1);
        }
        if (typeof v === 'boolean' && v) filterUse.set(k, (filterUse.get(k) ?? 0) + 1);
      }
    }
    if (e.name === 'hospital_viewed' && typeof e.props.hospital_id === 'string') {
      viewed.set(e.props.hospital_id, (viewed.get(e.props.hospital_id) ?? 0) + 1);
    }
    if (e.name === 'booking_initiated' && typeof e.props.hospital_id === 'string') {
      booked.set(e.props.hospital_id, (booked.get(e.props.hospital_id) ?? 0) + 1);
    }
  }

  const viewedNotBooked = [...viewed.entries()]
    .map(([id, v]) => ({ hospitalId: id, views: v, bookings: booked.get(id) ?? 0 }))
    .filter((r) => r.views >= 3)
    .sort((a, b) => (b.views - b.bookings) - (a.views - a.bookings))
    .slice(0, 10);

  return {
    totals: Object.fromEntries(byName),
    zeroResultRate: searches ? zero / searches : 0,
    mostUsedFilters: [...filterUse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    viewedRarelyBooked: viewedNotBooked,
    note: 'Views are engagement signals only. They are never used as evidence of hospital quality.',
  };
}

export function __resetAnalytics() { events.length = 0; }
