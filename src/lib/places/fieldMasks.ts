/**
 * Field masks are mandatory for Place Details / Text Search / Nearby Search in
 * the Places API (New), and billing is charged at the HIGHEST SKU any
 * requested field belongs to. We therefore keep three tightly-scoped masks and
 * never use `*`.
 *
 * SKU notes (developers.google.com/maps/billing-and-pricing/sku-details):
 *   Essentials  : places.id, places.name, nextPageToken
 *   Pro         : displayName, formattedAddress, location, photos, googleMapsUri,
 *                 accessibilityOptions, primaryType, businessStatus
 *   Enterprise  : rating, userRatingCount, websiteUri, nationalPhoneNumber,
 *                 regularOpeningHours, currentOpeningHours
 *   Ent+Atmos   : reviews, reviewSummary, editorialSummary, generativeSummary
 */
export const FIELD_MASKS = {
  /** Cheapest: used for "is this place id still valid" refreshes. Essentials. */
  idOnly: 'id',

  /** Discovery list card. Pro + Enterprise (rating drives the Enterprise SKU). */
  searchCard: [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.primaryType',
    'places.businessStatus',
    'places.googleMapsUri',
    'places.rating',
    'places.userRatingCount',
  ].join(','),

  /** Hospital profile header. Enterprise. */
  detailsCore: [
    'id', 'displayName', 'formattedAddress', 'location', 'googleMapsUri',
    'rating', 'userRatingCount', 'websiteUri', 'nationalPhoneNumber',
    'regularOpeningHours', 'accessibilityOptions', 'photos',
  ].join(','),

  /**
   * Reviews tab only, loaded lazily on user action because it triggers the
   * Enterprise + Atmosphere SKU (the most expensive tier).
   */
  detailsReviews: ['id', 'googleMapsUri', 'reviews', 'reviewSummary'].join(','),

  /** Autocomplete suggestions. */
  autocomplete: [
    'suggestions.placePrediction.placeId',
    'suggestions.placePrediction.text',
    'suggestions.placePrediction.structuredFormat',
  ].join(','),
} as const;

export type FieldMaskName = keyof typeof FIELD_MASKS;
