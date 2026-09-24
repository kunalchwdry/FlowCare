import 'server-only';

/**
 * F6 — Mode-aware reachability.
 *
 * Problem P7: "4.2 km away" is not a usable fact. S42 (51,580 visits) found
 * the odds of a missed appointment for the lowest-income group on the longest
 * bus journeys at OR 1.55, and — the part that matters here — that car and
 * bus estimates are NOT substitutable. Sorting a hospital list by straight-
 * line distance quietly ranks for people who drive.
 *
 * HARD CONSTRAINTS (docs/research/03-review-and-plan.md §10.1 R6):
 *  1. Never present one mode's duration as another's. If transit routing is
 *     unavailable, we return `minutes: null` and say so. We do NOT fall back
 *     to the driving time, and we do NOT synthesise minutes from distance.
 *  2. Travel times are never persisted. Google Maps Service Terms §14.3
 *     permits caching place IDs and (<=30d) coordinates, nothing else.
 *     These results are request-scoped and returned with no-store.
 *  3. When routing is not configured we degrade to straight-line DISTANCE
 *     only, clearly labelled — because a straight line is a real fact about
 *     geography, whereas a straight-line "duration" is a fabrication.
 */
import { env, routingConfigured } from '@/lib/env';
import { haversineKm } from '@/lib/discovery/geo';
import type { GeoPoint, TravelEstimate, TravelMode } from '@/lib/types';

export const TRAVEL_METHOD_VERSION = 'fc-travel-v1';

export const TRAVEL_MODES: TravelMode[] = ['walk', 'transit', 'drive'];

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  walk: 'Walking',
  transit: 'Bus / train',
  drive: 'Car / auto',
};

/** Google Routes API travel modes, keyed by ours. */
const ROUTES_TRAVEL_MODE: Record<TravelMode, string> = {
  walk: 'WALK',
  transit: 'TRANSIT',
  drive: 'DRIVE',
};

export const NOT_CONFIGURED_MESSAGE =
  'FlowCare cannot calculate journey time here. The distance below is a ' +
  'straight line, not a route — real travel will take longer.';

export const ROUTING_ERROR_MESSAGE =
  'Journey time could not be calculated right now. The straight-line ' +
  'distance is shown instead.';

export const NO_TRANSIT_MESSAGE =
  'No public transport route was found for this journey. This may mean ' +
  'there is no direct service, not that the hospital is unreachable.';

/** Straight-line-only estimate. Honest about being a floor, not a duration. */
export function straightLineEstimate(
  from: GeoPoint,
  to: GeoPoint,
  mode: TravelMode,
  status: TravelEstimate['status'],
  message: string,
): TravelEstimate {
  return {
    mode,
    minutes: null,
    distanceKm: Math.round(haversineKm(from, to) * 10) / 10,
    basis: 'straight_line',
    status,
    message,
  };
}

const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Field mask keeps the response — and the bill — to exactly what we use. */
const ROUTES_FIELD_MASK = 'routes.duration,routes.distanceMeters';

interface RoutesResponse {
  routes?: Array<{ duration?: string; distanceMeters?: number }>;
}

/**
 * Compute one estimate for one mode. Request-scoped; the caller must not
 * persist the result.
 */
export async function estimateTravel(
  from: GeoPoint,
  to: GeoPoint,
  mode: TravelMode,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TravelEstimate> {
  if (!routingConfigured()) {
    return straightLineEstimate(from, to, mode, 'not_configured', NOT_CONFIGURED_MESSAGE);
  }

  const key = env.googleMapsServerKey();
  if (!key) {
    return straightLineEstimate(from, to, mode, 'not_configured', NOT_CONFIGURED_MESSAGE);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const body: Record<string, unknown> = {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: ROUTES_TRAVEL_MODE[mode],
      languageCode: env.placesLanguage(),
      regionCode: env.placesRegion().toUpperCase(),
    };
    // Traffic awareness is only valid for DRIVE.
    if (mode === 'drive') body.routingPreference = 'TRAFFIC_AWARE';

    const res = await fetch(ROUTES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': ROUTES_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      return straightLineEstimate(from, to, mode, 'error', ROUTING_ERROR_MESSAGE);
    }

    const json = (await res.json()) as RoutesResponse;
    const route = json.routes?.[0];

    if (!route?.duration) {
      const message = mode === 'transit' ? NO_TRANSIT_MESSAGE : ROUTING_ERROR_MESSAGE;
      return straightLineEstimate(from, to, mode, 'unsupported_mode', message);
    }

    // Routes API returns duration as a protobuf Duration string, e.g. "1234s".
    const seconds = Number(String(route.duration).replace(/s$/, ''));
    if (!Number.isFinite(seconds)) {
      return straightLineEstimate(from, to, mode, 'error', ROUTING_ERROR_MESSAGE);
    }

    return {
      mode,
      minutes: Math.max(1, Math.round(seconds / 60)),
      distanceKm: route.distanceMeters != null
        ? Math.round((route.distanceMeters / 1000) * 10) / 10
        : null,
      basis: 'routing',
      status: 'ok',
      message: null,
    };
  } catch {
    return straightLineEstimate(from, to, mode, 'error', ROUTING_ERROR_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estimate several modes at once. Each mode is resolved independently so a
 * transit failure never contaminates the driving number, and vice versa.
 */
export async function estimateAllModes(
  from: GeoPoint,
  to: GeoPoint,
  modes: TravelMode[] = TRAVEL_MODES,
  opts: { timeoutMs?: number } = {},
): Promise<TravelEstimate[]> {
  return Promise.all(modes.map((m) => estimateTravel(from, to, m, opts)));
}

/**
 * Presentation helper used by the UI and the comparison table.
 * Returns a string that is never a duration unless one was actually measured.
 */
export function describeEstimate(e: TravelEstimate): string {
  if (e.minutes != null && e.basis === 'routing') {
    const dist = e.distanceKm != null ? ` · ${e.distanceKm} km` : '';
    return `${e.minutes} min by ${TRAVEL_MODE_LABELS[e.mode].toLowerCase()}${dist}`;
  }
  if (e.distanceKm != null) return `${e.distanceKm} km in a straight line`;
  return 'Distance unavailable';
}
