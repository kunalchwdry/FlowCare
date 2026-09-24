'use client';

/**
 * F17 — the human review queue.
 *
 * This screen is the reason the feature is allowed to exist. A correction
 * workflow with no reviewer is just an unmoderated write path to the
 * directory; the whole design rests on a person sitting here and deciding.
 *
 * Note what the reviewer is NOT given: a "confirm all", a bulk action, or an
 * AI recommendation. Consistent with the moderation stance elsewhere in
 * FlowCare, a machine may flag and a person decides.
 */
import { useCallback, useEffect, useState } from 'react';
import { IconCheck, IconInfo } from './Icons';
import { STATUS_LABELS } from '@/lib/journey/corrections';
import { EVIDENCE_KINDS } from '@/lib/journey/vocab';
import type { FacilityCorrection } from '@/lib/types';

type Row = FacilityCorrection & { hospitalName: string | null };

const TABS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'duplicate', label: 'Duplicates' },
] as const;

export function CorrectionQueue() {
  const [tab, setTab] = useState<string>('pending');
  const [rows, setRows] = useState<Row[]>([]);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/corrections?status=${tab}`);
    if (res.status === 401 || res.status === 403) { setAuthed(false); return; }
    const j = await res.json();
    if (j.ok) { setAuthed(true); setRows(j.data.corrections ?? []); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function decide(id: string, decision: 'confirmed' | 'rejected' | 'duplicate') {
    setBusy(id);
    try {
      await fetch('/api/admin/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correctionId: id,
          decision,
          ...(outcome[id]?.trim() ? { outcome: outcome[id].trim() } : {}),
        }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (authed === false) {
    return (
      <div className="fc-card p-6 text-center">
        <h1 className="text-lg font-bold">Admins only</h1>
        <p className="mt-1.5 text-sm text-ink-600">
          The correction queue is restricted to moderator accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <header>
        <h1 className="text-xl font-extrabold text-ink-900">Correction queue</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Reports from patients about facility details. Nothing here has changed
          what the public sees — that only happens when you confirm it.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'fc-chip-on' : 'fc-chip-off'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="fc-card p-6 text-center text-sm text-ink-600">
          Nothing in this queue.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li key={c.id} className="fc-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-ink-900">
                    {c.hospitalName ?? c.hospitalId}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {c.fieldCode} · reported{' '}
                    {new Date(c.createdAt).toLocaleString('en-IN')}
                  </p>
                </div>
                <span className="fc-pill bg-ink-100 text-ink-700 !text-[10.5px]">
                  {STATUS_LABELS[c.status]}
                </span>
              </div>

              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-semibold text-ink-500">Evidence</dt>
                  <dd className="text-ink-800">
                    {EVIDENCE_KINDS.find((e) => e.code === c.evidenceKind)?.label ?? c.evidenceKind}
                  </dd>
                </div>
                {c.claimedValue && (
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-ink-500">Says it is</dt>
                    <dd className="text-ink-800">{c.claimedValue}</dd>
                  </div>
                )}
                {c.note && (
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-ink-500">Note</dt>
                    <dd className="text-ink-800">{c.note}</dd>
                  </div>
                )}
                {c.reviewedAt && (
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-ink-500">Reviewed</dt>
                    <dd className="text-ink-800">
                      {new Date(c.reviewedAt).toLocaleString('en-IN')}
                      {c.outcome && ` — ${c.outcome}`}
                    </dd>
                  </div>
                )}
              </dl>

              {c.status === 'pending' && (
                <div className="mt-3 border-t border-ink-100 pt-3">
                  <label className="block">
                    <span className="fc-label">What did you find? (recorded in the audit log)</span>
                    <input
                      className="fc-input mt-1 !py-2 !text-xs"
                      maxLength={300}
                      value={outcome[c.id] ?? ''}
                      onChange={(e) => setOutcome({ ...outcome, [c.id]: e.target.value })}
                      placeholder="e.g. called the hospital, number confirmed changed"
                    />
                  </label>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="fc-btn-primary !py-1.5 !text-xs"
                      disabled={busy === c.id}
                      onClick={() => decide(c.id, 'confirmed')}
                    >
                      <IconCheck width={13} height={13} /> Confirm and update
                    </button>
                    <button
                      type="button"
                      className="fc-btn-secondary !py-1.5 !text-xs"
                      disabled={busy === c.id}
                      onClick={() => decide(c.id, 'rejected')}
                    >
                      No change needed
                    </button>
                    <button
                      type="button"
                      className="fc-btn-ghost !py-1.5 !text-xs"
                      disabled={busy === c.id}
                      onClick={() => decide(c.id, 'duplicate')}
                    >
                      Duplicate
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="fc-card bg-ink-50 p-4">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-600">
          <IconInfo width={14} height={14} className="mt-0.5 shrink-0" />
          There is no bulk action and no automated suggestion on this screen by
          design. Every decision is one person, one report, recorded against
          your account in the audit log.
        </p>
      </section>
    </div>
  );
}
