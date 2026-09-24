/**
 * Google Maps Platform compliance constants, expressed as code so that the
 * rules are testable rather than aspirational.
 *
 * Sources (retrieved 2026-09-27):
 *  - Google Maps Platform Service Specific Terms §14.3 (Places API caching):
 *    lat/lng may be temporarily cached for up to 30 consecutive calendar days,
 *    after which it must be deleted.
 *    https://cloud.google.com/maps-platform/terms/maps-service-terms
 *  - Service Specific Terms §A.3 (Google ID caching): place_id may be cached.
 *  - Places API policies: place ID is exempt from caching restrictions;
 *    Google Maps attribution and author attribution for UGC are required.
 *    https://developers.google.com/maps/documentation/places/web-service/policies
 *  - Place IDs should be refreshed if older than 12 months.
 *    https://developers.google.com/maps/documentation/javascript/place-id
 *
 * Practical consequence for FlowCare: the ONLY Google-derived values that
 * reach Supabase are the place id (indefinite) and lat/lng (≤30 days, with an
 * explicit expiry timestamp). Names, ratings, reviews, photos, phone numbers,
 * opening hours and review summaries are fetched live per request, held in a
 * short-lived in-process cache, and never written to the database.
 */
export const PLACES_POLICY = {
  /** Fields we may persist in Supabase. */
  PERSISTABLE_FIELDS: ['placeId'] as const,
  /** Fields we may persist but must expire. */
  EXPIRING_PERSISTABLE_FIELDS: ['cachedLat', 'cachedLng'] as const,
  COORD_CACHE_MAX_DAYS: 30,
  /** Recommended refresh interval for stored place IDs. */
  PLACE_ID_REFRESH_DAYS: 365,
  /** In-process, non-durable cache TTL for display content (performance only). */
  DISPLAY_CACHE_TTL_MS: 5 * 60_000,
  ATTRIBUTION_TEXT: 'Google Maps',
  /** Content that must never be written to durable storage. */
  NON_PERSISTABLE_FIELDS: [
    'displayName', 'formattedAddress', 'rating', 'userRatingCount', 'reviews',
    'reviewSummary', 'photos', 'nationalPhoneNumber', 'internationalPhoneNumber',
    'websiteUri', 'regularOpeningHours', 'currentOpeningHours', 'editorialSummary',
    'accessibilityOptions', 'googleMapsUri',
  ] as const,
} as const;

export function coordCacheExpired(cachedAt: string | null, now: Date = new Date()): boolean {
  if (!cachedAt) return true;
  const ageDays = (now.getTime() - new Date(cachedAt).getTime()) / 86_400_000;
  return ageDays > PLACES_POLICY.COORD_CACHE_MAX_DAYS;
}

export function placeIdNeedsRefresh(verifiedAt: string | null, now: Date = new Date()): boolean {
  if (!verifiedAt) return true;
  const ageDays = (now.getTime() - new Date(verifiedAt).getTime()) / 86_400_000;
  return ageDays > PLACES_POLICY.PLACE_ID_REFRESH_DAYS;
}

/** Guard used by the repository layer and asserted by tests. */
export function assertPersistable(fieldNames: string[]): void {
  const banned = fieldNames.filter((f) =>
    (PLACES_POLICY.NON_PERSISTABLE_FIELDS as readonly string[]).includes(f));
  if (banned.length) {
    throw new Error(
      `Google Maps Platform policy violation: attempted to persist restricted Places field(s): ${banned.join(', ')}`,
    );
  }
}
