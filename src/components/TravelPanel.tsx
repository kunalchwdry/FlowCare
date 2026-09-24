'use client';

/**
 * F6 — Mode-aware reachability.
 *
 * The honesty rule is visible here: when routing is not configured (or the
 * mode has no route), this panel shows a straight-line DISTANCE and says so.
 * It never shows a number of minutes that was not measured, and it never
 * borrows the driving time to fill in the transit row — S42 found those are
 * not substitutable, and a bus rider planning against a car estimate is the
 * person this feature exists for.
 */
import { useState } from 'react';
import { IconClock, IconInfo, IconPin } from './Icons';
import { useGeolocation } from '@/lib/client/hooks';
import type { TravelEstimate, TravelMode } from '@/lib/types';

const MODE_LABELS: Record<TravelMode, string> = {
  walk: 'Walking',
  transit: 'Bus / train',
  drive: 'Car / auto',
};

export function TravelPanel({
  hospitalId,
  hospitalName,
}: {
  hospitalId: string;
  hospitalName: string;
}) {
  const geo = useGeolocation();
  const [estimates, setEstimates] = useState<TravelEstimate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!geo.point) {
      geo.request();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalId,
          origin: { lat: geo.point.lat, lng: geo.point.lng },
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error?.message ?? 'Could not work out journey times.');
        return;
      }
      setEstimates(j.data.estimates);
    } catch {
      setError('Could not work out journey times.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="fc-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <IconPin width={15} height={15} className="text-ink-500" /> How long to get there
      </h2>

      {!estimates && (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
            Journey time depends a lot on how you travel. FlowCare works each
            mode out separately rather than showing one distance.
          </p>
          <button
            type="button"
            className="fc-btn-secondary mt-2.5 !py-1.5 !text-xs"
            onClick={run}
            disabled={loading}
          >
            {loading ? 'Checking…' : geo.point ? 'Check from my location' : 'Use my location'}
          </button>
          {geo.state.status === 'denied' && (
            <p className="mt-2 text-[11px] text-amber-700">{geo.state.reason}</p>
          )}
          {geo.state.status === 'unsupported' && (
            <p className="mt-2 text-[11px] text-amber-700">
              This browser cannot share your location.
            </p>
          )}
        </>
      )}

      {error && <p role="alert" className="mt-2 text-[11px] text-rose-700">{error}</p>}

      {estimates && (
        <>
          <ul className="mt-2.5 divide-y divide-ink-100">
            {estimates.map((e) => (
              <li key={e.mode} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink-700">{MODE_LABELS[e.mode]}</span>
                  <span className="text-sm font-bold tabular-nums text-ink-900">
                    {e.minutes != null && e.basis === 'routing' ? (
                      `${e.minutes} min`
                    ) : (
                      <span className="font-medium text-ink-500">
                        {e.distanceKm != null ? `${e.distanceKm} km direct` : 'Unknown'}
                      </span>
                    )}
                  </span>
                </div>
                {e.message && (
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">{e.message}</p>
                )}
                {e.basis === 'routing' && e.distanceKm != null && (
                  <p className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-500">
                    <IconClock width={11} height={11} /> {e.distanceKm} km by road
                  </p>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-2.5 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink-500">
            <IconInfo width={12} height={12} className="mt-0.5 shrink-0" />
            Journey times are worked out fresh each time and are not stored.
            They are an estimate for {hospitalName}, not a guarantee.
          </p>
        </>
      )}
    </section>
  );
}
