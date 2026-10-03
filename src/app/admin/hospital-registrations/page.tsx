'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconShield } from '@/components/Icons';
import { formatDateTime } from '@/lib/time';

interface Registration {
  id: string;
  hospital_id: string | null;
  hospital_name: string | null;
  proposed_name: string | null;
  proposed_city: string | null;
  address: string | null;
  website: string | null;
  admin_name: string;
  admin_email: string;
  admin_phone: string | null;
  evidence_note: string | null;
  license_number: string | null;
  license_authority: string | null;
  license_expires_on: string | null;
  status: 'pending' | 'verifying' | 'approved' | 'rejected' | 'removed';
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
}

interface Payload {
  requests: Registration[];
  summary: Record<string, number>;
}

const STATUS_STYLE: Record<Registration['status'], string> = {
  pending: 'bg-amber-100 text-amber-900',
  verifying: 'bg-sky-100 text-sky-900',
  approved: 'bg-emerald-100 text-emerald-900',
  rejected: 'bg-rose-100 text-rose-900',
  removed: 'bg-ink-200 text-ink-700',
};

export const dynamic = 'force-dynamic';

export default function HospitalRegistrationsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const response = await fetch('/api/admin/hospital-registrations', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? 'Could not load the reviewer queue.');
      setData(json.data);
      setSelected((current) => current && json.data.requests.some((r: Registration) => r.id === current) ? current : json.data.requests[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the reviewer queue.');
    }
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    return status === 'active'
      ? data.requests.filter((r) => r.status === 'pending' || r.status === 'verifying')
      : data.requests;
  }, [data, status]);

  const current = visible.find((r) => r.id === selected) ?? visible[0] ?? null;

  useEffect(() => {
    if (current) setNote(current.review_note ?? '');
  }, [current?.id]);

  async function decide(decision: 'approved' | 'rejected' | 'verifying' | 'removed') {
    if (!current) return;
    if ((decision === 'rejected' || decision === 'removed') && !note.trim()) {
      setError(decision === 'removed' ? 'Add a reason before removing a hospital.' : 'Add a reason before rejecting an application.');
      return;
    }
    const confirmation = decision === 'approved'
      ? 'Approve this hospital and give the applicant administrator access?'
      : decision === 'rejected'
        ? 'Reject this hospital application?'
        : decision === 'removed'
          ? 'Remove this approved hospital? It will be unpublished and all active hospital access will be revoked.'
          : 'Move this application into verification?';
    if (!window.confirm(confirmation)) return;

    setBusy(current.id);
    setError(null);
    try {
      const response = await fetch('/api/admin/hospital-registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: current.id, decision, note: note.trim() || null }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? 'Could not save the decision.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the decision.');
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <div className="fc-card p-8 text-center">
          <IconShield width={28} height={28} className="mx-auto text-ink-300" />
          <h1 className="mt-3 text-xl font-extrabold">Reviewer access required</h1>
          <p className="mt-2 text-sm text-ink-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return <p className="py-12 text-center text-sm text-ink-500">Loading hospital registrations…</p>;

  return (
    <div className="space-y-5 py-2">
      <header className="flex flex-wrap items-start gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">FlowCare operations</p>
          <h1 className="mt-1 text-2xl font-extrabold text-ink-900">Hospital review dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Verify the organisation and the administrator before creating a listing or granting portal access.
            Approval is a human decision and is recorded in the audit trail.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="fc-btn-secondary ml-auto !min-h-[38px] !py-2 text-xs">Refresh queue</button>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="Needs review" value={data.summary.pending ?? 0} tone="amber" />
        <Metric label="Verifying" value={data.summary.verifying ?? 0} tone="sky" />
        <Metric label="Approved" value={data.summary.approved ?? 0} tone="green" />
        <Metric label="Rejected" value={data.summary.rejected ?? 0} tone="rose" />
      </section>

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setStatus('active')} className={`rounded-lg px-3 py-2 text-xs font-bold ${status === 'active' ? 'bg-brand-600 text-white' : 'border border-ink-300 text-ink-700'}`}>
          Open applications ({(data.summary.pending ?? 0) + (data.summary.verifying ?? 0)})
        </button>
        <button type="button" onClick={() => setStatus('all')} className={`rounded-lg px-3 py-2 text-xs font-bold ${status === 'all' ? 'bg-brand-600 text-white' : 'border border-ink-300 text-ink-700'}`}>
          All decisions ({data.requests.length})
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="fc-card p-10 text-center">
          <p className="text-base font-bold text-ink-800">No applications in this view</p>
          <p className="mt-1 text-sm text-ink-500">New hospital registrations will appear here after somebody submits the registration form.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-500">Applications</h2>
            {visible.map((r) => {
              const name = r.hospital_name ?? r.proposed_name ?? 'Unnamed hospital';
              return (
                <button key={r.id} type="button" onClick={() => setSelected(r.id)} className={`w-full rounded-xl border p-3 text-left transition ${current?.id === r.id ? 'border-brand-500 bg-brand-50 shadow-sm' : 'border-ink-200 bg-white hover:border-brand-300'}`}>
                  <div className="flex items-start gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                    <span className="ml-auto text-[11px] text-ink-400">{formatDateTime(r.created_at)}</span>
                  </div>
                  <p className="mt-2 font-bold text-ink-900">{name}</p>
                  <p className="mt-0.5 text-xs text-ink-600">{r.proposed_city ?? 'Existing FlowCare listing'} · {r.admin_name}</p>
                  <p className="mt-1 truncate text-xs text-ink-500">{r.admin_email}</p>
                </button>
              );
            })}
          </section>

          {current && <ReviewPanel registration={current} note={note} setNote={setNote} busy={busy === current.id} decide={decide} />}
        </div>
      )}

      <p className="text-xs text-ink-500">
        This first reviewer release captures license details and verification notes. Uploaded license files are not yet part of the application form; never approve a request based on a typed number alone.
      </p>
    </div>
  );
}

function ReviewPanel({ registration: r, note, setNote, busy, decide }: { registration: Registration; note: string; setNote: (v: string) => void; busy: boolean; decide: (decision: 'approved' | 'rejected' | 'verifying' | 'removed') => Promise<void> }) {
  const name = r.hospital_name ?? r.proposed_name ?? 'Unnamed hospital';
  const canDecide = r.status === 'pending' || r.status === 'verifying';
  const canRemove = r.status === 'approved';
  return (
    <section className="fc-card p-5">
      <div className="flex flex-wrap items-start gap-2 border-b border-ink-100 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-extrabold text-ink-900">{name}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>{r.status}</span>
          </div>
          <p className="mt-1 text-xs text-ink-500">Application submitted {formatDateTime(r.created_at)}</p>
        </div>
        {r.hospital_id ? <span className="ml-auto rounded-lg bg-ink-100 px-2 py-1 font-mono text-[10px] text-ink-600">Claim existing listing</span> : <span className="ml-auto rounded-lg bg-brand-50 px-2 py-1 text-[10px] font-bold text-brand-800">New listing</span>}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Info title="Administrator" value={r.admin_name} detail={r.admin_email} />
        <Info title="Phone" value={r.admin_phone ?? 'Not supplied'} />
        <Info title="Address" value={r.address ?? 'Not supplied'} />
        <Info title="Website" value={r.website ?? 'Not supplied'} link={r.website ?? undefined} />
        <Info title="License/registration number" value={r.license_number ?? 'Not supplied'} />
        <Info title="Issuing authority" value={r.license_authority ?? 'Not supplied'} />
        <Info title="License expiry" value={r.license_expires_on ?? 'Not supplied'} />
        <Info title="Applicant evidence note" value={r.evidence_note ?? 'No note supplied'} />
      </div>

      <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
        <p className="text-sm font-bold text-sky-950">Reviewer checklist</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-sky-950">
          <li>Confirm the hospital name and address against an official source.</li>
          <li>Call the official hospital number or verify the applicant through the hospital website.</li>
          <li>Check the license number and issuing authority outside FlowCare.</li>
          <li>Do not approve based on a work email or typed license number alone.</li>
        </ul>
      </div>

      <label className="mt-5 block">
        <span className="text-sm font-semibold text-ink-800">Reviewer note</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className="fc-input mt-1" placeholder="Record what you checked, or what the applicant must clarify." disabled={(!canDecide && !canRemove) || busy} />
      </label>

      {canDecide && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void decide('verifying')} className="fc-btn-secondary !min-h-[38px] !py-2 text-xs">Mark verifying</button>
          <button type="button" disabled={busy} onClick={() => void decide('rejected')} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject</button>
          <button type="button" disabled={busy} onClick={() => void decide('approved')} className="fc-btn-primary !min-h-[38px] !py-2 text-xs">{busy ? 'Saving…' : 'Approve & grant access'}</button>
        </div>
      )}
      {canRemove && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs text-rose-900">Removing this hospital will unpublish its listing and revoke active portal access. The record and audit history will be preserved.</p>
          <button type="button" disabled={busy} onClick={() => void decide('removed')} className="mt-2 rounded-lg border border-rose-400 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-50">{busy ? 'Removing…' : 'Remove hospital'}</button>
        </div>
      )}
      {!canDecide && !canRemove && (
        <div className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">This application has already been decided.</div>
      )}
    </section>
  );
}

function Info({ title, value, detail, link }: { title: string; value: string; detail?: string; link?: string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{title}</p>
      {link ? <a href={link} target="_blank" rel="noreferrer" className="mt-1 block break-words text-sm font-semibold text-brand-700 underline underline-offset-2">{value}</a> : <p className="mt-1 break-words text-sm font-semibold text-ink-800">{value}</p>}
      {detail && <p className="mt-0.5 break-words text-xs text-ink-500">{detail}</p>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'sky' | 'green' | 'rose' }) {
  const style = { amber: 'border-amber-200 bg-amber-50', sky: 'border-sky-200 bg-sky-50', green: 'border-emerald-200 bg-emerald-50', rose: 'border-rose-200 bg-rose-50' }[tone];
  return <div className={`rounded-xl border p-4 ${style}`}><p className="text-xs font-semibold text-ink-600">{label}</p><p className="mt-1 text-2xl font-extrabold text-ink-900">{value}</p></div>;
}
