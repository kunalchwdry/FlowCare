'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CareAccessOption, CareAccessRequest, CareAccessMetrics, CareTask } from '@/lib/careAccess/types';

interface Row { request: CareAccessRequest; options: CareAccessOption[]; tasks: CareTask[] }

const LABELS: Record<string, string> = {
  REFERRAL_SUBMITTED: 'Pending acknowledgement', APPROVAL_PENDING: 'Approval pending', APPROVED: 'Approved', REJECTED: 'Rejected',
  ACKNOWLEDGED: 'Acknowledged', INFO_REQUESTED: 'Information requested', WAITLISTED: 'Waitlisted',
  ACCEPTED: 'Accepted', REDIRECTED: 'Redirected', SLOT_OFFERED: 'Slot offered', BOOKED: 'Booked',
  APPROVAL_EXPIRED: 'Approval expired', RECOVERY_REQUIRED: 'Recovery required', RECOVERY_OPTIONS_AVAILABLE: 'Recovery options ready',
  ARRIVED: 'Arrived', SERVICE_COMPLETED: 'Service completed', FOLLOW_UP_OPEN: 'Follow-up open', CLOSED: 'Closed',
};

export function HospitalCareAccessPanel({ hospitalId, canManage, canQueue }: { hospitalId: string; canManage: boolean; canQueue: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [metrics, setMetrics] = useState<CareAccessMetrics | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState('');

  async function load() {
    const res = await fetch('/api/hospital/care-requests', { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) { setError(json?.error?.message ?? 'Could not load the care access queue.'); return; }
    setRows(json.data.requests ?? []); setMetrics(json.data.metrics ?? null);
    setSelected((current) => current && (json.data.requests ?? []).some((r: Row) => r.request.id === current) ? current : json.data.requests?.[0]?.request.id ?? null);
  }
  useEffect(() => { void load(); }, []);

  const current = rows.find((r) => r.request.id === selected) ?? null;
  const actionOptions = useMemo(() => {
    if (!current) return [];
    const state = current.request.state;
    if (state === 'REFERRAL_SUBMITTED') return ['acknowledge'];
    if (state === 'APPROVAL_PENDING') return ['approve', 'reject', 'request_info'];
    if (state === 'APPROVAL_EXPIRED') return ['request_recovery'];
    if (state === 'RECOVERY_REQUIRED') return ['offer_recovery'];
    if (state === 'ACKNOWLEDGED') return ['accept', 'request_info', 'redirect'];
    if (state === 'APPROVED' || state === 'ACCEPTED' || state === 'REDIRECTED' || state === 'WAITLISTED') return ['offer_slot'];
    if (state === 'BOOKED' || state === 'REMINDER') return ['arrive', 'no_show', 'reschedule'];
    if (state === 'ARRIVED') return ['complete'];
    if (state === 'FOLLOW_UP_OPEN') return ['close'];
    return [];
  }, [current]);

  async function transition(action: string, optionId?: string) {
    if (!current) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/hospital/care-requests/${current.request.id}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, optionId, expectedVersion: current.request.version, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Could not record that transition.');
      setReason(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not record that transition.'); }
    finally { setBusy(false); }
  }

  async function publishCapacity(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/hospital/capacity-signals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: true, queueWaitMinutes: wait ? Number(wait) : null, note: 'Updated by hospital staff', expiresAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Could not publish capacity.');
      setWait(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not publish capacity.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="Requests" value={metrics?.total ?? '—'} />
        <Metric label="Closed" value={metrics?.closed ?? '—'} tone="good" />
        <Metric label="Unresolved" value={metrics?.unresolved ?? '—'} tone="warn" />
        <Metric label="Closure rate" value={metrics?.closureRate == null ? 'Not enough data' : `${metrics.closureRate}%`} />
      </section>
      {canQueue && <section className="fc-card p-4"><div className="flex flex-wrap items-end gap-3"><div><h2 className="text-sm font-bold text-ink-900">Publish capacity signal</h2><p className="mt-1 text-xs text-ink-500">This is a dated operational signal. Patients will see its expiry.</p></div><form onSubmit={publishCapacity} className="ml-auto flex items-end gap-2"><label className="text-xs font-semibold text-ink-700">Wait minutes<input value={wait} onChange={(e) => setWait(e.target.value)} type="number" min="0" max="1440" className="fc-input mt-1 w-28" placeholder="e.g. 25" /></label><button type="submit" disabled={busy} className="fc-btn-secondary text-xs">Publish for 6h</button></form></div></section>}
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,.8fr)_minmax(0,1.5fr)]">
        <section className="space-y-2"><div className="flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-wide text-ink-500">Referral queue</h2><span className="text-xs text-ink-500">{rows.length} visible</span></div>{rows.length === 0 && <div className="fc-card p-6 text-sm text-ink-500">No care requests have selected this hospital yet.</div>}{rows.map((row) => <button key={row.request.id} type="button" onClick={() => setSelected(row.request.id)} className={`w-full rounded-xl border p-3 text-left ${selected === row.request.id ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:border-brand-300'}`}><div className="flex items-center gap-2"><span className="fc-pill bg-ink-100 text-ink-700">{LABELS[row.request.state] ?? row.request.state}</span><span className="ml-auto text-[11px] text-ink-400">v{row.request.version}</span></div><p className="mt-2 text-sm font-bold text-ink-900">{row.request.specialty ?? row.request.serviceType}</p><p className="mt-1 text-xs text-ink-600">{row.request.location ?? 'Location not specified'} · {row.request.languagePreference.join(', ') || 'Language not specified'}</p></button>)}</section>
        {current && <section className="fc-card p-5"><div className="flex flex-wrap items-start gap-3"><div><p className="fc-eyebrow">Care request</p><h2 className="mt-1 text-xl font-extrabold text-ink-900">{current.request.specialty ?? current.request.serviceType}</h2><p className="mt-1 text-xs text-ink-500">Patient ID {current.request.patientId.slice(0, 8)}… · location {current.request.location ?? 'not specified'}</p></div><span className="fc-pill ml-auto bg-brand-50 text-brand-800">{LABELS[current.request.state] ?? current.request.state}</span></div><div className="mt-4 rounded-xl bg-ink-50 p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Selected option</p>{current.options.find((o) => o.id === current.request.selectedOptionId) ? <><p className="mt-1 text-sm font-bold text-ink-900">{current.options.find((o) => o.id === current.request.selectedOptionId)?.hospitalName}</p><p className="mt-1 text-xs text-ink-600">{current.options.find((o) => o.id === current.request.selectedOptionId)?.slotLabel ?? 'No slot recorded yet'}</p></> : <p className="mt-1 text-sm text-ink-600">No option selected.</p>}</div>{actionOptions.length > 0 && canManage && <div className="mt-4"><p className="text-xs font-bold uppercase tracking-wide text-ink-500">Record next operational step</p>{actionOptions.some((a) => ['request_info', 'redirect', 'reschedule', 'no_show', 'reject', 'request_recovery'].includes(a)) && <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} rows={2} placeholder="Reason shown to the patient" className="fc-input mt-2 w-full" />}{<div className="mt-2 flex flex-wrap gap-2">{actionOptions.map((action) => <button key={action} type="button" disabled={busy || (['request_info', 'redirect', 'reschedule', 'no_show', 'reject', 'request_recovery'].includes(action) && !reason.trim())} onClick={() => void transition(action, action === 'offer_slot' ? current.request.selectedOptionId ?? undefined : undefined)} className={action === 'accept' || action === 'acknowledge' ? 'fc-btn-primary text-xs disabled:opacity-50' : 'fc-btn-secondary text-xs disabled:opacity-50'}>{action.replaceAll('_', ' ')}</button>)}</div>}</div>}{current.tasks.length > 0 && <div className="mt-5 border-t border-ink-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-ink-500">Open tasks</p><ul className="mt-2 space-y-2">{current.tasks.map((task) => <li key={task.id} className="rounded-lg border border-ink-200 p-3 text-xs"><p className="font-semibold text-ink-900">{task.title}</p><p className="mt-1 text-ink-500">{task.status}</p></li>)}</ul></div>}</section>}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'good' | 'warn' }) {
  return <div className="rounded-xl border border-ink-200 bg-white p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</p><p className={`mt-1 text-2xl font-extrabold ${tone === 'good' ? 'text-brand-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink-900'}`}>{value}</p></div>;
}
