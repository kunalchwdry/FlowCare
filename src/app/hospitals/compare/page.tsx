'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AvailabilityPill, FlowCareRating, GoogleRating, SourceTag } from '@/components/Badges';
import { IconClose, IconInfo } from '@/components/Icons';
import { label } from '@/lib/discovery/filters';
import { formatDistance } from '@/lib/discovery/geo';
import { useCompareBasket, useGeolocation } from '@/lib/client/hooks';
import type { DiscoveryResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Row = Omit<DiscoveryResult, 'match'>;

function CompareInner() {
  const sp = useSearchParams();
  const basket = useCompareBasket();
  const geo = useGeolocation();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState('');

  const ids = (sp.get('ids') ?? basket.ids.join(',')).split(',').filter(Boolean);

  useEffect(() => {
    if (ids.length < 2) { setRows([]); return; }
    const p = new URLSearchParams({ ids: ids.join(',') });
    if (geo.point) { p.set('lat', String(geo.point.lat)); p.set('lng', String(geo.point.lng)); }
    fetch(`/api/hospitals/compare?${p.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error?.message ?? 'Could not load comparison');
        setRows(j.data.hospitals);
        setDisclaimer(j.data.disclaimer);
      })
      .catch((e) => setError(e.message));
  }, [ids.join(','), geo.point?.lat, geo.point?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ids.length < 2) {
    return (
      <div className="fc-card mt-6 p-8 text-center">
        <p className="text-base font-bold">Pick at least two hospitals</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">
          Use the compare button on any hospital card to build a side-by-side view of up to four hospitals.
        </p>
        <Link href="/hospitals" className="fc-btn-primary mt-4">Go to discovery</Link>
      </div>
    );
  }

  if (error) return <p className="fc-card mt-6 p-6 text-center text-sm font-semibold text-rose-700">{error}</p>;
  if (!rows) return <p className="py-10 text-center text-sm text-ink-500">Loading comparison…</p>;

  const FIELDS: Array<{ k: string; render: (r: Row) => React.ReactNode; source: 'flowcare' | 'google' | 'mixed' }> = [
    { k: 'Distance', source: 'flowcare', render: (r) => (r.distanceKm !== null ? formatDistance(r.distanceKm) : 'Set a location to compare distance') },
    { k: 'Hospital type', source: 'flowcare', render: (r) => label(r.hospital.type) },
    { k: 'Appointment availability', source: 'flowcare', render: (r) => (
      <AvailabilityPill state={r.availability.state} nextDate={r.availability.nextAvailableDate} computedAt={r.availability.computedAt} />
    ) },
    { k: 'Earliest bookable date', source: 'flowcare', render: (r) => r.availability.nextAvailableDate ?? '—' },
    { k: 'Open slots (next 14 days)', source: 'flowcare', render: (r) => (r.availability.openSlots === null ? 'Unknown' : String(r.availability.openSlots)) },
    { k: 'FlowCare rating', source: 'flowcare', render: (r) => <FlowCareRating summary={r.flowcareRating} showMethod /> },
    { k: 'FlowCare reviews', source: 'flowcare', render: (r) => `${r.flowcareRating.reviewCount} verified visits` },
    { k: 'Google rating', source: 'google', render: (r) => (
      r.external.data?.rating !== undefined
        ? <GoogleRating rating={r.external.data.rating} count={r.external.data.userRatingCount} uri={r.external.data.googleMapsUri} />
        : <span className="text-xs text-ink-400">{r.external.linked ? 'Not retrieved' : 'No Google Place linked'}</span>
    ) },
    { k: 'Patient traffic', source: 'flowcare', render: (r) => (
      r.traffic?.available
        ? `${r.traffic.trafficLevel} · ${r.traffic.waitingCount} waiting · ${r.traffic.estimatedWaitMinutes === null ? 'wait time unavailable' : `~${r.traffic.estimatedWaitMinutes} min estimated wait`}`
        : 'Traffic unavailable'
    ) },
    { k: 'Departments', source: 'flowcare', render: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.hospital.departments.filter((d) => d.active).map((d) => (
          <span key={d.id} className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-700">{d.name}</span>
        ))}
      </div>
    ) },
    { k: 'Services', source: 'flowcare', render: (r) => r.hospital.services.map((s) => s.name).join(', ') || '—' },
    { k: 'Accessibility', source: 'flowcare', render: (r) => (r.hospital.accessibility.length ? r.hospital.accessibility.map(label).join(', ') : 'Not recorded') },
    { k: 'Languages', source: 'flowcare', render: (r) => r.hospital.languages.map(label).join(', ') },
    { k: 'Emergency services', source: 'flowcare', render: (r) => (r.hospital.emergencyServices ? 'Yes' : 'No') },
  ];

  return (
    <div className="space-y-4 py-2">
      <header>
        <h1 className="text-xl font-extrabold">Compare hospitals</h1>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-600">
          <IconInfo width={14} height={14} className="mt-0.5 shrink-0" /> {disclaimer}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-40 bg-ink-50 p-2 text-left text-xs font-bold text-ink-500">Factor</th>
              {rows.map((r) => (
                <th key={r.hospital.id} className="min-w-[200px] border-l border-ink-200 bg-white p-3 text-left align-top">
                  <div className="flex items-start gap-1">
                    <Link href={`/hospitals/${r.hospital.slug}`} className="text-sm font-bold text-ink-900 hover:text-brand-700">
                      {r.hospital.name}
                    </Link>
                    <button
                      onClick={() => basket.remove(r.hospital.id)}
                      aria-label={`Remove ${r.hospital.name}`}
                      className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-100"
                    >
                      <IconClose width={14} height={14} />
                    </button>
                  </div>
                  <p className="mt-0.5 text-[11px] font-normal text-ink-500">{r.hospital.addressLine}</p>
                  <Link
                    href={`/appointments/new?hospital=${r.hospital.slug}`}
                    className={`fc-btn-primary mt-2 w-full !min-h-[36px] !py-1.5 text-[11px] ${r.availability.state === 'none' ? 'pointer-events-none opacity-40' : ''}`}
                  >
                    Book
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => (
              <tr key={f.k} className="border-t border-ink-200">
                <th scope="row" className="sticky left-0 z-10 bg-ink-50 p-2 text-left align-top text-xs font-semibold text-ink-600">
                  {f.k}
                  <div className="mt-1"><SourceTag source={f.source === 'google' ? 'google' : 'flowcare'} /></div>
                </th>
                {rows.map((r) => (
                  <td key={r.hospital.id} className="border-l border-ink-200 p-3 align-top text-xs text-ink-700">
                    {f.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rounded-xl bg-ink-100 px-3 py-2.5 text-[11px] text-ink-600">
        FlowCare deliberately does not compute an overall winner. Distance, availability, ratings and review counts
        measure different things, and none of them measure clinical quality.
      </p>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-ink-500">Loading…</p>}>
      <CompareInner />
    </Suspense>
  );
}
