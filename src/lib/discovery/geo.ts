import type { GeoPoint } from '@/lib/types';

const R_EARTH_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Privacy: we never store or log a patient's precise coordinates. Discovery
 * analytics and any server-side persistence use a ~1.1 km grid (2 decimals).
 * Straight-line distance shown to the user is still computed from the precise
 * in-memory value for that request only.
 */
export function coarsen(p: GeoPoint, decimals = 2): GeoPoint {
  const f = 10 ** decimals;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}

export function formatDistance(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return 'Distance unavailable';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

/** Known city anchors for "hospitals in <city>" when no browser location exists. */
export const CITY_ANCHORS: Record<string, GeoPoint> = {
  pune: { lat: 18.5204, lng: 73.8567 },
  'pimpri-chinchwad': { lat: 18.6298, lng: 73.7997 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  nashik: { lat: 19.9975, lng: 73.7898 },
  nagpur: { lat: 21.1458, lng: 79.0882 },
};

export function anchorForCity(city?: string): GeoPoint | null {
  if (!city) return null;
  return CITY_ANCHORS[city.trim().toLowerCase()] ?? null;
}
