/**
 * Server-only Google Places API (New) client.
 * The API key never leaves the server: browser code calls /api/places/* which
 * proxies to this module.
 */
import 'server-only';
import { env, googleMapsConfigured } from '@/lib/env';
import { FIELD_MASKS } from './fieldMasks';
import { PLACES_POLICY } from './policy';
import type { ExternalPlaceData, GeoPoint } from '@/lib/types';

const BASE = 'https://places.googleapis.com/v1';

export type PlacesStatus = 'ok' | 'not_configured' | 'error';

export interface PlacesOutcome<T> {
  status: PlacesStatus;
  data: T | null;
  /** Safe, user-facing message. Never contains the API key or raw provider text. */
  message?: string;
  httpStatus?: number;
}

/** In-process display cache. Performance only; never durable, never shared. */
const displayCache = new Map<string, { at: number; value: unknown }>();

function cacheGet<T>(key: string): T | null {
  const hit = displayCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PLACES_POLICY.DISPLAY_CACHE_TTL_MS) {
    displayCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown) {
  if (displayCache.size > 500) displayCache.clear();
  displayCache.set(key, { at: Date.now(), value });
}

export function __clearPlacesCache() { displayCache.clear(); }

async function call<T>(
  path: string,
  init: RequestInit & { fieldMask: string },
  timeoutMs = 6000,
): Promise<PlacesOutcome<T>> {
  const key = env.googleMapsServerKey();
  if (!key) return { status: 'not_configured', data: null, message: 'Google Maps is not configured on this deployment.' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': init.fieldMask,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      // Log status only — never the body, which may echo the request.
      console.warn(`[places] ${path} -> HTTP ${res.status}`);
      return {
        status: 'error',
        data: null,
        httpStatus: res.status,
        message:
          res.status === 429 ? 'Google Maps quota exceeded. Showing FlowCare data only.'
          : res.status === 403 ? 'Google Maps rejected this request (check API enablement and key restrictions).'
          : 'Google Maps data is temporarily unavailable.',
      };
    }
    return { status: 'ok', data: (await res.json()) as T };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    console.warn(`[places] ${path} -> ${aborted ? 'timeout' : 'network error'}`);
    return { status: 'error', data: null, message: aborted ? 'Google Maps request timed out.' : 'Could not reach Google Maps.' };
  }
}

function toExternal(place: Record<string, any>): ExternalPlaceData {
  return {
    placeId: place.id,
    displayName: place.displayName?.text,
    formattedAddress: place.formattedAddress,
    location: place.location ? { lat: place.location.latitude, lng: place.location.longitude } : undefined,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    googleMapsUri: place.googleMapsUri,
    websiteUri: place.websiteUri,
    nationalPhoneNumber: place.nationalPhoneNumber,
    regularOpeningHours: place.regularOpeningHours,
    accessibilityOptions: place.accessibilityOptions,
    photos: place.photos,
    reviews: place.reviews,
    reviewSummary: place.reviewSummary,
    fetchedAt: new Date().toISOString(),
  };
}

export async function placeDetails(
  placeId: string,
  variant: 'core' | 'reviews' = 'core',
): Promise<PlacesOutcome<ExternalPlaceData>> {
  if (!/^[A-Za-z0-9_\-]{5,256}$/.test(placeId)) {
    return { status: 'error', data: null, message: 'Invalid place identifier.' };
  }
  const mask = variant === 'reviews' ? FIELD_MASKS.detailsReviews : FIELD_MASKS.detailsCore;
  const ck = `details:${variant}:${placeId}`;
  const cached = cacheGet<ExternalPlaceData>(ck);
  if (cached) return { status: 'ok', data: cached };

  const out = await call<Record<string, any>>(
    `/places/${encodeURIComponent(placeId)}?languageCode=${env.placesLanguage()}&regionCode=${env.placesRegion()}`,
    { method: 'GET', fieldMask: mask },
  );
  if (out.status !== 'ok' || !out.data) return { ...out, data: null };
  const mapped = toExternal(out.data);
  cacheSet(ck, mapped);
  return { status: 'ok', data: mapped };
}

export async function textSearch(
  textQuery: string,
  opts: { bias?: GeoPoint; radiusM?: number; maxResults?: number } = {},
): Promise<PlacesOutcome<ExternalPlaceData[]>> {
  const q = textQuery.trim().slice(0, 200);
  if (!q) return { status: 'error', data: null, message: 'Empty search query.' };
  const ck = `text:${q}:${opts.bias?.lat ?? ''},${opts.bias?.lng ?? ''}:${opts.radiusM ?? ''}`;
  const cached = cacheGet<ExternalPlaceData[]>(ck);
  if (cached) return { status: 'ok', data: cached };

  const body: Record<string, unknown> = {
    textQuery: q,
    maxResultCount: Math.min(opts.maxResults ?? 10, 20),
    languageCode: env.placesLanguage(),
    regionCode: env.placesRegion(),
    includedType: 'hospital',
  };
  if (opts.bias) {
    body.locationBias = {
      circle: { center: { latitude: opts.bias.lat, longitude: opts.bias.lng }, radius: Math.min(opts.radiusM ?? 15000, 50000) },
    };
  }
  const out = await call<{ places?: Record<string, any>[] }>('/places:searchText', {
    method: 'POST',
    body: JSON.stringify(body),
    fieldMask: FIELD_MASKS.searchCard,
  });
  if (out.status !== 'ok') return { ...out, data: null };
  const mapped = (out.data?.places ?? []).map(toExternal);
  cacheSet(ck, mapped);
  return { status: 'ok', data: mapped };
}

export async function nearbySearch(
  center: GeoPoint,
  radiusM = 5000,
  maxResults = 10,
): Promise<PlacesOutcome<ExternalPlaceData[]>> {
  const ck = `near:${center.lat.toFixed(3)},${center.lng.toFixed(3)}:${radiusM}`;
  const cached = cacheGet<ExternalPlaceData[]>(ck);
  if (cached) return { status: 'ok', data: cached };

  const out = await call<{ places?: Record<string, any>[] }>('/places:searchNearby', {
    method: 'POST',
    fieldMask: FIELD_MASKS.searchCard,
    body: JSON.stringify({
      includedTypes: ['hospital'],
      maxResultCount: Math.min(maxResults, 20),
      languageCode: env.placesLanguage(),
      regionCode: env.placesRegion(),
      locationRestriction: {
        circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusM, 50000) },
      },
    }),
  });
  if (out.status !== 'ok') return { ...out, data: null };
  const mapped = (out.data?.places ?? []).map(toExternal);
  cacheSet(ck, mapped);
  return { status: 'ok', data: mapped };
}

export interface AutocompleteSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

export async function autocomplete(
  input: string,
  opts: { sessionToken?: string; bias?: GeoPoint } = {},
): Promise<PlacesOutcome<AutocompleteSuggestion[]>> {
  const q = input.trim().slice(0, 120);
  if (q.length < 2) return { status: 'ok', data: [] };

  const body: Record<string, unknown> = {
    input: q,
    languageCode: env.placesLanguage(),
    regionCode: env.placesRegion(),
    includedRegionCodes: [env.placesRegion()],
    // Session tokens group the typing session with the follow-up details call
    // for billing. Generated per-session in the browser, forwarded by our proxy.
    ...(opts.sessionToken ? { sessionToken: opts.sessionToken } : {}),
  };
  if (opts.bias) {
    body.locationBias = { circle: { center: { latitude: opts.bias.lat, longitude: opts.bias.lng }, radius: 30000 } };
  }

  const out = await call<{ suggestions?: Record<string, any>[] }>('/places:autocomplete', {
    method: 'POST',
    fieldMask: FIELD_MASKS.autocomplete,
    body: JSON.stringify(body),
  }, 3500);
  if (out.status !== 'ok') return { ...out, data: null };
  const mapped: AutocompleteSuggestion[] = (out.data?.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p: Record<string, any>) => ({
      placeId: p.placeId,
      primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }));
  return { status: 'ok', data: mapped };
}

/** Builds the server-side photo URL. Photos are streamed through our proxy. */
export function photoMediaUrl(photoName: string, maxWidthPx = 640): string | null {
  const key = env.googleMapsServerKey();
  if (!key) return null;
  return `${BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=false&key=${key}`;
}

export { googleMapsConfigured };
