'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPin } from './Icons';
import type { DiscoveryResult, GeoPoint } from '@/lib/types';

/**
 * Map with graceful degradation.
 *
 *  - When NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY is set we lazily load the Maps
 *    JavaScript API and render real Google tiles (Places content shown beside
 *    the map is attributed separately).
 *  - When it is not set we render a built-in SCHEMATIC map: FlowCare's own
 *    hospital coordinates projected onto an SVG. It is explicitly labelled as
 *    not being a real map, so nothing here pretends to be Google data.
 *
 * The map is never the only way to discover hospitals — /hospitals is the
 * list-first surface and this view always offers a "list" switch.
 */
declare global {
  interface Window { google?: any; __fcMapsLoading?: Promise<void> }
}

function loadGoogleMaps(key: string, mapId?: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__fcMapsLoading) return window.__fcMapsLoading;
  window.__fcMapsLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', libraries: 'marker', loading: 'async' });
    if (mapId) params.set('map_ids', mapId);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('maps_script_failed'));
    document.head.appendChild(s);
  });
  return window.__fcMapsLoading;
}

export function MapView({
  results, origin, selectedId, onSelect,
}: {
  results: DiscoveryResult[];
  origin: GeoPoint | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const browserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
  // MapTiler first: it is the configured provider here and needs no Google
  // billing account. Google stays supported for deployments that have one,
  // and the schematic remains the floor so the page is never blank.
  const initialMode = maptilerKey ? 'maptiler' : browserKey ? 'loading' : 'schematic';
  const [mode, setMode] = useState<'loading' | 'google' | 'maptiler' | 'schematic'>(initialMode);
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (maptilerKey) return;            // handled by the MapLibre effect below
    if (!browserKey) { setMode('schematic'); return; }
    let cancelled = false;
    loadGoogleMaps(browserKey, mapId)
      .then(() => { if (!cancelled) setMode('google'); })
      .catch(() => { if (!cancelled) setMode('schematic'); });
    return () => { cancelled = true; };
  }, [browserKey, mapId, maptilerKey]);

  useEffect(() => {
    if (mode !== 'google' || !ref.current || !window.google?.maps) return;
    const g = window.google.maps;
    if (!mapRef.current) {
      mapRef.current = new g.Map(ref.current, {
        center: origin ?? results[0]?.hospital.location ?? { lat: 18.5204, lng: 73.8567 },
        zoom: 12,
        mapId: mapId || undefined,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
      });
    }
    markersRef.current.forEach((m) => { m.map = null; m.setMap?.(null); });
    markersRef.current = [];

    const bounds = new g.LatLngBounds();
    for (const r of results) {
      const marker = new g.Marker({
        position: r.hospital.location,
        map: mapRef.current,
        title: r.hospital.name,
      });
      marker.addListener('click', () => onSelect(r.hospital.id));
      markersRef.current.push(marker);
      bounds.extend(r.hospital.location);
    }
    if (origin) bounds.extend(origin);
    if (results.length) mapRef.current.fitBounds(bounds, 48);
  }, [mode, results, origin, mapId, onSelect]);

  /**
   * MapTiler via MapLibre GL.
   *
   * Loaded with a dynamic import so neither the library nor its stylesheet
   * reaches a bundle that never renders a map — it is a sizeable dependency
   * and discovery works perfectly well without it.
   *
   * The key is a browser key and is visible in network requests by design,
   * exactly like a Google browser key; the protection is the domain
   * restriction set on it in the MapTiler dashboard, not secrecy. If the
   * style fails to load for any reason the schematic takes over, so a
   * revoked or rate-limited key degrades instead of leaving a blank panel.
   */
  useEffect(() => {
    if (mode !== 'maptiler' || !ref.current || !maptilerKey) return;
    let cancelled = false;
    let map: any = null;

    (async () => {
      const maplibre = await import('maplibre-gl');
      // @ts-expect-error -- stylesheet side-effect import, no type declaration
      await import('maplibre-gl/dist/maplibre-gl.css');
      if (cancelled || !ref.current) return;

      const centre = origin ?? results[0]?.hospital.location ?? { lat: 18.5204, lng: 73.8567 };
      map = new maplibre.Map({
        container: ref.current,
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${maptilerKey}`,
        center: [centre.lng, centre.lat],
        zoom: 11,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', () => { if (!cancelled) setMode('schematic'); });
      mapRef.current = map;

      map.on('load', () => {
        if (cancelled) return;
        const bounds = new maplibre.LngLatBounds();
        for (const r of results) {
          const { lat, lng } = r.hospital.location;
          const el = document.createElement('button');
          el.type = 'button';
          el.setAttribute('aria-label', r.hospital.name);
          const active = r.hospital.id === selectedId;
          el.style.cssText = [
            'width:16px', 'height:16px', 'border-radius:9999px', 'cursor:pointer',
            `background:${active ? '#1a7a79' : '#3dbbb9'}`,
            'border:2px solid #fff', 'box-shadow:0 1px 4px rgba(0,0,0,.35)',
          ].join(';');
          el.addEventListener('click', (e) => { e.stopPropagation(); onSelect(r.hospital.id); });
          new maplibre.Marker({ element: el }).setLngLat([lng, lat])
            .setPopup(new maplibre.Popup({ offset: 14, closeButton: false })
              .setText(r.hospital.name))
            .addTo(map);
          bounds.extend([lng, lat]);
        }
        if (origin) bounds.extend([origin.lng, origin.lat]);
        if (results.length) map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 });
      });
    })().catch(() => { if (!cancelled) setMode('schematic'); });

    return () => { cancelled = true; if (map) { map.remove(); mapRef.current = null; } };
  }, [mode, maptilerKey, results, origin, selectedId, onSelect]);

  if (mode === 'maptiler') {
    return (
      <div className="relative h-full w-full">
        <div ref={ref} className="h-full w-full" />
      </div>
    );
  }

  if (mode === 'google') {
    return (
      <div className="relative h-full w-full">
        <div ref={ref} className="h-full w-full" />
      </div>
    );
  }

  return <SchematicMap results={results} origin={origin} selectedId={selectedId} onSelect={onSelect} loading={mode === 'loading'} />;
}

/** Deterministic non-Google fallback map. */
function SchematicMap({
  results, origin, selectedId, onSelect, loading,
}: {
  results: DiscoveryResult[]; origin: GeoPoint | null; selectedId: string | null;
  onSelect: (id: string | null) => void; loading: boolean;
}) {
  const { points, originPt } = useMemo(() => {
    const coords = results.map((r) => r.hospital.location);
    if (origin) coords.push(origin);
    if (coords.length === 0) return { points: [], originPt: null };

    const lats = coords.map((c) => c.lat);
    const lngs = coords.map((c) => c.lng);
    const pad = 0.012;
    const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad;
    const minLng = Math.min(...lngs) - pad, maxLng = Math.max(...lngs) + pad;
    const spanLat = Math.max(maxLat - minLat, 0.001);
    const spanLng = Math.max(maxLng - minLng, 0.001);

    const project = (p: GeoPoint) => ({
      x: ((p.lng - minLng) / spanLng) * 100,
      y: (1 - (p.lat - minLat) / spanLat) * 100,
    });

    return {
      points: results.map((r) => ({ r, ...project(r.hospital.location) })),
      originPt: origin ? project(origin) : null,
    };
  }, [results, origin]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#eef2f7]">
      <svg aria-hidden className="absolute inset-0 h-full w-full opacity-60">
        <defs>
          <pattern id="fcgrid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M44 0H0v44" fill="none" stroke="#cdd7e4" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#fcgrid)" />
      </svg>

      <div className="absolute left-3 top-3 z-10 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] font-semibold text-ink-600 shadow">
        {loading ? 'Loading map…' : 'Schematic map — Google Maps not configured'}
      </div>

      <div className="absolute inset-0">
        {originPt && (
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${originPt.x}%`, top: `${originPt.y}%` }}>
            <span className="block h-4 w-4 rounded-full border-2 border-white bg-brand-600 shadow-lg" title="Your search location" />
            <span className="absolute inset-0 -z-10 block h-4 w-4 animate-ping rounded-full bg-brand-500/50" />
          </div>
        )}

        {points.map(({ r, x, y }) => {
          const on = selectedId === r.hospital.id;
          const avail = r.availability.state;
          const color =
            avail === 'available' ? 'bg-emerald-600'
            : avail === 'limited' ? 'bg-amber-500'
            : avail === 'none' ? 'bg-rose-500' : 'bg-ink-400';
          return (
            <button
              key={r.hospital.id}
              type="button"
              aria-label={`${r.hospital.name}, ${r.availability.state}`}
              onClick={() => onSelect(on ? null : r.hospital.id)}
              className="absolute -translate-x-1/2 -translate-y-full focus:outline-none"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span className={`flex items-center gap-1 rounded-full ${color} px-2 py-1 text-white shadow-md transition-transform ${on ? 'scale-125 ring-4 ring-white' : 'hover:scale-110'}`}>
                <IconPin width={13} height={13} />
                <span className="max-w-[110px] truncate text-[10px] font-bold">{r.hospital.name.split(' ')[0]}</span>
              </span>
            </button>
          );
        })}
      </div>

      {results.length === 0 && (
        <p className="absolute inset-0 grid place-items-center text-sm text-ink-500">No hospitals to plot for this search.</p>
      )}
    </div>
  );
}
