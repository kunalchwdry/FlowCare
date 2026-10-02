'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AvailabilityPill, FlowCareRating } from '@/components/Badges';
import { IconCalendar, IconHeart } from '@/components/Icons';
import type { Hospital } from '@/lib/types';
import { formatDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

interface SavedRow { hospitalId: string; createdAt: string; note: string | null; hospital: Hospital }

export default function SavedPage() {
  const [rows, setRows] = useState<SavedRow[] | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const load = () => {
    fetch('/api/favorites')
      .then(async (r) => {
        if (r.status === 401) { setNeedsAuth(true); setRows([]); return null; }
        return r.json();
      })
      .then((j) => j && setRows(j.data.favorites))
      .catch(() => setRows([]));
  };

  useEffect(load, []);

  const remove = async (id: string) => {
    await fetch(`/api/favorites?hospitalId=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-4 py-2">
      <header>
        <h1 className="text-xl font-extrabold">Saved hospitals</h1>
        <p className="mt-1 text-xs text-ink-600">
          Private to your FlowCare account. Row-level security means no other patient can read your saved list.
        </p>
      </header>

      {needsAuth && (
        <div className="fc-card p-8 text-center">
          <p className="text-base font-bold">Sign in to see your saved hospitals</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">
            Saving is tied to your FlowCare account so that your shortlist follows you across devices.
          </p>
          <Link href="/hospitals" className="fc-btn-secondary mt-4">Browse hospitals</Link>
        </div>
      )}

      {rows && !needsAuth && rows.length === 0 && (
        <div className="fc-card p-8 text-center">
          <IconHeart width={28} height={28} className="mx-auto text-ink-300" />
          <p className="mt-2 text-base font-bold">Nothing saved yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">
            Tap the heart on any hospital to keep it here for quick booking later.
          </p>
          <Link href="/hospitals" className="fc-btn-primary mt-4">Discover hospitals</Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows?.map((row) => (
          <article key={row.hospitalId} className="fc-card p-4">
            <h2 className="text-sm font-bold">
              <Link href={`/hospitals/${row.hospital.slug}`} className="hover:text-brand-700">{row.hospital.name}</Link>
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">{row.hospital.addressLine}</p>
            <p className="mt-1 text-[10px] text-ink-400">Saved {formatDate(row.createdAt)}</p>
            <div className="mt-3 flex gap-2">
              <Link href={`/appointments/new?hospital=${row.hospital.slug}`} className="fc-btn-primary flex-1 !min-h-[38px] !py-1.5 text-xs">
                <IconCalendar width={14} height={14} /> Book
              </Link>
              <button onClick={() => remove(row.hospitalId)} className="fc-btn-secondary !min-h-[38px] !py-1.5 text-xs">Remove</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
