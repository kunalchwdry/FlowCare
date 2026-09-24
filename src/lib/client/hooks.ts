'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Stable per-tab session id used for privacy-conscious analytics only. */
export function useSessionId(): string {
  const [id, setId] = useState('anon');
  useEffect(() => {
    let v = sessionStorage.getItem('fc_sid');
    if (!v) {
      v = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('fc_sid', v);
    }
    setId(v);
  }, []);
  return id;
}

export function trackEvent(name: string, sessionId: string, props: Record<string, string | number | boolean | null> = {}) {
  if (typeof window === 'undefined') return;
  void fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sessionId, props }),
    keepalive: true,
  }).catch(() => {});
}

export type GeoState =
  | { status: 'idle' }
  | { status: 'prompting' }
  | { status: 'granted'; lat: number; lng: number }
  | { status: 'denied'; reason: string }
  | { status: 'unsupported' }
  | { status: 'manual'; lat: number; lng: number; label: string };

/**
 * Location is always optional. Nothing in the app requires precise location:
 * if permission is denied we fall back to city/area search.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: 'idle' });

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'unsupported' });
      return;
    }
    setState({ status: 'prompting' });
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({ status: 'granted', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        setState({
          status: 'denied',
          reason:
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was declined. Search by city or area instead.'
              : 'Your location could not be determined. Search by city or area instead.',
        }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const setManual = useCallback((lat: number, lng: number, labelText: string) => {
    setState({ status: 'manual', lat, lng, label: labelText });
  }, []);

  const clear = useCallback(() => setState({ status: 'idle' }), []);

  const point =
    state.status === 'granted' || state.status === 'manual' ? { lat: state.lat, lng: state.lng } : null;

  return { state, point, request, setManual, clear };
}

/** Hospital comparison basket, persisted per-tab. Max 4. */
export const MAX_COMPARE = 4;

export function useCompareBasket() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('fc_compare');
      if (raw) setIds(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const persist = (next: string[]) => {
    setIds(next);
    try { localStorage.setItem('fc_compare', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const toggle = (id: string) => {
    persist(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_COMPARE ? ids : [...ids, id]);
  };
  const remove = (id: string) => persist(ids.filter((x) => x !== id));
  const clear = () => persist([]);

  return { ids, toggle, remove, clear, full: ids.length >= MAX_COMPARE };
}

/** Recently viewed hospitals — local only, minimal, user-clearable. */
export const RECENT_KEY = 'fc_recent_hospitals';
export const RECENT_LIMIT = 8;

export function pushRecentlyViewed(id: string, name: string) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: Array<{ id: string; name: string; at: string }> = raw ? JSON.parse(raw) : [];
    const next = [{ id, name, at: new Date().toISOString() }, ...list.filter((x) => x.id !== id)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export function useRecentlyViewed() {
  const [items, setItems] = useState<Array<{ id: string; name: string; at: string }>>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setItems(raw ? JSON.parse(raw) : []);
    } catch { /* ignore */ }
  }, []);
  const clear = () => {
    try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
    setItems([]);
  };
  return { items, clear };
}

/** Debounce with request cancellation, used for autocomplete. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback((...args: A) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}
