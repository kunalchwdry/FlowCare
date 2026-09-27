'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/States';
import { STAFF_ROLE_LABELS, type StaffAccessRequest, type StaffRole } from '@/lib/staff/roles';

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function AccessRequestList({ initial }: { initial: StaffAccessRequest[] }) {
  const [rows, setRows] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function decide(id: string, decision: 'approved' | 'rejected') {
    setBusyId(id);
    setError(null);
    setFlash(null);
    try {
      const r = await fetch(`/api/staff/access-requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? 'We could not record that decision.');
        return;
      }
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...j.data.request } : row)));
      setFlash(j.data.message);
    } catch {
      setError('We could not reach FlowCare. Your decision was not saved — try again.');
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((r) => r.status === 'pending');
  const decided = rows.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-900 ring-1 ring-danger-200">
          {error}
        </div>
      )}
      {flash && (
        <div role="status" className="rounded-xl bg-success-50 px-4 py-3 text-sm text-success-700 ring-1 ring-success-100">
          {flash}
        </div>
      )}

      <section className="fc-card p-5">
        <h2 className="fc-h2">Pending requests</h2>
        <p className="mt-1 text-sm text-ink-600">
          Nobody below can see patient or queue data until you approve them.
        </p>

        {pending.length === 0 ? (
          <EmptyState
            compact
            title="No requests waiting"
            description="When a colleague registers against this hospital, their request appears here for your decision."
          />
        ) : (
          <ul className="mt-4 space-y-3">
            {pending.map((r) => (
              <li key={r.id} className="rounded-xl border border-ink-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-900">{r.fullName}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">{r.email}</p>
                  </div>
                  <span className="fc-pill-warn">Pending</span>
                </div>

                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-500">Requested role</dt>
                    <dd className="mt-0.5 font-semibold text-ink-900">
                      {STAFF_ROLE_LABELS[r.requestedRole as StaffRole] ?? r.requestedRole}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Staff ID</dt>
                    <dd className="mt-0.5 font-semibold text-ink-900">{r.staffId ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">Submitted</dt>
                    <dd className="mt-0.5 font-semibold text-ink-900">{fmt(r.createdAt)}</dd>
                  </div>
                </dl>

                {r.requestedRole === 'hospital_admin' && (
                  <p className="mt-3 rounded-lg bg-warn-50 px-3 py-2 text-[11px] leading-relaxed text-warn-900 ring-1 ring-warn-200">
                    This person is asking for administrator rights — they would be able to approve
                    further colleagues. Confirm with them directly before approving.
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => decide(r.id, 'approved')}
                    disabled={busyId === r.id}
                    className="fc-btn-primary text-sm"
                  >
                    {busyId === r.id ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(r.id, 'rejected')}
                    disabled={busyId === r.id}
                    className="fc-btn-secondary text-sm"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section className="fc-card p-5">
          <h2 className="fc-h2">Decided</h2>
          <ul className="mt-4 divide-y divide-ink-100">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-900">{r.fullName}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {STAFF_ROLE_LABELS[r.requestedRole as StaffRole] ?? r.requestedRole}
                    {r.decidedAt ? ` · ${fmt(r.decidedAt)}` : ''}
                  </span>
                </span>
                <span className={r.status === 'approved' ? 'fc-pill-success' : 'fc-pill-muted'}>
                  {r.status === 'approved' ? 'Approved' : 'Rejected'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
