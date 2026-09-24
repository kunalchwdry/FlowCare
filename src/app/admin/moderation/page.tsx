'use client';

import { useEffect, useState } from 'react';
import { IconShield } from '@/components/Icons';
import type { HospitalReview, ModerationEvent, ReviewReport } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface Payload {
  queue: HospitalReview[];
  reports: Array<ReviewReport & { review: HospitalReview | null }>;
  events: ModerationEvent[];
}

export default function ModerationPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch('/api/admin/moderation')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) { setDenied(j.error?.message ?? 'Access denied'); return null; }
        return j.data;
      })
      .then((d) => d && setData(d))
      .catch(() => setDenied('Could not load the moderation queue.'));
  };

  useEffect(load, []);

  const act = async (reviewId: string, action: string, reason: string, reportId?: string) => {
    setBusy(reviewId);
    await fetch('/api/admin/moderation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId, action, reason, reportId: reportId ?? null }),
    });
    setBusy(null);
    load();
  };

  if (denied) {
    return (
      <div className="fc-card mt-6 p-8 text-center">
        <IconShield width={26} height={26} className="mx-auto text-ink-300" />
        <p className="mt-2 text-base font-bold">Moderation is restricted</p>
        <p className="mt-1 text-sm text-ink-600">{denied}</p>
      </div>
    );
  }
  if (!data) return <p className="py-10 text-center text-sm text-ink-500">Loading moderation queue…</p>;

  return (
    <div className="space-y-4 py-2">
      <header>
        <h1 className="text-xl font-extrabold">Review moderation</h1>
        <p className="mt-1 text-xs text-ink-600">
          Automated checks can only route a review to this queue. Every hide, restore or removal is a human decision and
          is written to the moderation event log with the actor, reason and status transition.
        </p>
      </header>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">Awaiting a decision ({data.queue.length})</h2>
        <div className="mt-3 space-y-2">
          {data.queue.length === 0 && <p className="text-xs text-ink-500">Nothing is waiting for review.</p>}
          {data.queue.map((r) => (
            <article key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="fc-pill bg-amber-100 text-amber-900">{r.status}</span>
                <span className="font-semibold text-ink-700">{r.hospitalId}</span>
                <span className="text-ink-500">{r.authorHandle}</span>
                <span className="ml-auto text-ink-400">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              {r.comment && <p className="mt-1.5 text-xs text-ink-700">{r.comment}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button disabled={busy === r.id} onClick={() => act(r.id, 'publish', 'Reviewed by moderator — meets guidelines')} className="fc-btn-secondary !min-h-[34px] !py-1 text-[11px]">Publish</button>
                <button disabled={busy === r.id} onClick={() => act(r.id, 'hide', 'Reviewed by moderator — hidden pending further checks')} className="fc-btn-secondary !min-h-[34px] !py-1 text-[11px]">Hide</button>
                <button disabled={busy === r.id} onClick={() => act(r.id, 'remove', 'Reviewed by moderator — violates review guidelines')} className="fc-btn-secondary !min-h-[34px] !py-1 text-[11px] !text-rose-700">Remove</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">Reports ({data.reports.filter((r) => r.status === 'open').length} open)</h2>
        <div className="mt-3 space-y-2">
          {data.reports.length === 0 && <p className="text-xs text-ink-500">No reports submitted.</p>}
          {data.reports.map((rep) => (
            <article key={rep.id} className="rounded-xl border border-ink-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="fc-pill bg-ink-100 text-ink-700">{rep.reason}</span>
                <span className="fc-pill bg-ink-100 text-ink-700">{rep.status}</span>
                <span className="ml-auto text-ink-400">{new Date(rep.createdAt).toLocaleString()}</span>
              </div>
              {rep.review?.comment && <p className="mt-1.5 text-xs text-ink-700">“{rep.review.comment}”</p>}
              {rep.status === 'open' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button onClick={() => act(rep.reviewId, 'dismiss_report', 'Report reviewed — no action needed', rep.id)} className="fc-btn-secondary !min-h-[34px] !py-1 text-[11px]">Dismiss report</button>
                  <button onClick={() => act(rep.reviewId, 'hide', 'Hidden following a user report', rep.id)} className="fc-btn-secondary !min-h-[34px] !py-1 text-[11px]">Hide review</button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">Moderation event log</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[11px]">
            <thead className="text-ink-500">
              <tr>
                <th className="p-1.5 text-left">When</th><th className="p-1.5 text-left">Actor</th>
                <th className="p-1.5 text-left">Action</th><th className="p-1.5 text-left">Transition</th>
                <th className="p-1.5 text-left">Reason</th><th className="p-1.5 text-left">AI conf.</th>
              </tr>
            </thead>
            <tbody>
              {data.events.length === 0 && <tr><td colSpan={6} className="p-2 text-ink-500">No events yet.</td></tr>}
              {data.events.map((e) => (
                <tr key={e.id} className="border-t border-ink-100">
                  <td className="p-1.5 text-ink-500">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="p-1.5">{e.actorRole}</td>
                  <td className="p-1.5 font-semibold">{e.action}</td>
                  <td className="p-1.5 text-ink-600">{e.previousStatus} → {e.newStatus}</td>
                  <td className="p-1.5 text-ink-600">{e.reason}</td>
                  <td className="p-1.5 text-ink-600">{e.aiConfidence !== null ? e.aiConfidence.toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
