'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CareAccessOption, CareAccessRequest, CareStateTransition, CareTask } from '@/lib/careAccess/types';

interface JourneyPayload {
  request: CareAccessRequest;
  options: CareAccessOption[];
  transitions: CareStateTransition[];
  tasks: CareTask[];
}

const STATE_LABELS: Record<string, string> = {
  REQUESTED: 'Request received', SCREENED: 'Request screened', OPTIONS_OFFERED: 'Options ready',
  PATIENT_SELECTED: 'Hospital selected', REFERRAL_SUBMITTED: 'Referral submitted', APPROVAL_PENDING: 'Approval pending',
  APPROVAL_EXPIRED: 'Approval expired', APPROVED: 'Approved', REJECTED: 'Rejected', ACKNOWLEDGED: 'Hospital acknowledged',
  INFO_REQUESTED: 'Information needed', ACCEPTED: 'Referral accepted', WAITLISTED: 'Waitlisted', REDIRECTED: 'Redirected',
  SLOT_OFFERED: 'Slot offered', BOOKED: 'Booking confirmed', REMINDER: 'Reminder', RESCHEDULED: 'Rescheduled', RESCHEDULE_REQUESTED: 'Reschedule requested',
  RECOVERY_REQUIRED: 'Recovery required', RECOVERY_OPTIONS_AVAILABLE: 'Recovery options ready', REBOOKED: 'Rebooked',
  CANCELLED: 'Cancelled', ARRIVED: 'Arrived', NO_SHOW: 'Not attended', SERVICE_COMPLETED: 'Service completed',
  FOLLOW_UP_OPEN: 'Follow-up open', CLOSED: 'Care loop closed',
};

const STATE_ORDER = ['REQUESTED', 'SCREENED', 'OPTIONS_OFFERED', 'PATIENT_SELECTED', 'REFERRAL_SUBMITTED', 'APPROVAL_PENDING', 'APPROVED', 'SLOT_OFFERED', 'WAITLISTED', 'BOOKED', 'ARRIVED', 'SERVICE_COMPLETED', 'FOLLOW_UP_OPEN', 'CLOSED'];

export function CareAccessExchange() {
  const [requestText, setRequestText] = useState('');
  const [journeys, setJourneys] = useState<JourneyPayload[]>([]);
  const [active, setActive] = useState<JourneyPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/care-requests', { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (res.status === 401) { setSignedOut(true); return; }
    if (!res.ok || !json?.ok) { setError(json?.error?.message ?? 'Could not load your care journeys.'); return; }
    setSignedOut(false);
    setJourneys(json.data.requests ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!requestText.trim()) return;
    setBusy(true); setError(null); setActive(null);
    try {
      const res = await fetch('/api/care-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestText: requestText.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Could not create the care request.');
      const payload: JourneyPayload = { request: json.data.request, options: json.data.options ?? [], transitions: [], tasks: [] };
      setActive(payload); setRequestText(''); await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the care request.');
    } finally { setBusy(false); }
  }

  async function choose(option: CareAccessOption) {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/care-requests/${active.request.id}/options/${option.id}/select`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'That option is no longer available.');
      setActive({ ...active, request: json.data.request, options: json.data.options ?? active.options, transitions: json.data.transitions ?? active.transitions });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not select that option.'); }
    finally { setBusy(false); }
  }

  async function act(action: 'book' | 'cancel' | 'close', reason?: string) {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/care-requests/${active.request.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expectedVersion: active.request.version, ...(reason ? { reason } : {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Could not update the care journey.');
      setActive({ ...active, request: json.data.request, transitions: json.data.transitions ?? active.transitions });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the care journey.'); }
    finally { setBusy(false); }
  }

  async function completeTask(task: CareTask) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/care-tasks/${task.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', resolution: 'Completed by patient in FlowCare.' }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Could not complete that task.');
      if (active) {
        const detail = await fetch(`/api/care-requests/${active.request.id}`, { cache: 'no-store' });
        const detailJson = await detail.json().catch(() => null);
        if (detail.ok && detailJson?.ok) setActive(detailJson.data as JourneyPayload);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete that task.'); }
    finally { setBusy(false); }
  }

  if (signedOut) {
    return (
      <div className="fc-card p-8 text-center">
        <h1 className="text-xl font-extrabold text-ink-900">Sign in to use Care Access Exchange</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-600">Your care requests and referrals are private. Sign in to create a request and track it through the care loop.</p>
        <Link href="/patient/login?next=/care-access" className="fc-btn-primary mt-5">Sign in</Link>
      </div>
    );
  }

  const selected = active ?? journeys[0] ?? null;
  return (
    <div className="space-y-5 py-2">
      <header className="rounded-3xl border border-ink-200 bg-white p-6 shadow-card sm:p-8">
        <p className="fc-eyebrow">FlowCare operations</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">Care Access Exchange</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-600 sm:text-base">
          Describe the access you need. FlowCare filters for recorded capability first, then shows dated, explainable options. It does not diagnose, assign urgency, invent availability, or make a clinical referral decision.
        </p>
        <form onSubmit={createRequest} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            value={requestText} onChange={(e) => setRequestText(e.target.value)} maxLength={500}
            placeholder="e.g. I need an orthopedic consultation near Pune next week"
            className="fc-input min-h-[48px] flex-1"
            aria-label="Describe the care access you need"
          />
          <button type="submit" disabled={busy || !requestText.trim()} className="fc-btn-primary min-h-[48px] sm:px-5 disabled:opacity-50">
            {busy ? 'Checking…' : 'Find feasible options'}
          </button>
        </form>
        <p className="mt-2 text-[11px] text-ink-500">Administrative extraction only. If the request is unclear, FlowCare leaves fields unclassified for you or a qualified professional to review.</p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}

      {selected && (
        <>
          <JourneyCard payload={selected} busy={busy} onBook={() => void act('book')} onCancel={() => void act('cancel', 'Cancelled by patient.')} onClose={() => void act('close')} onTask={completeTask} />
          {['OPTIONS_OFFERED', 'RECOVERY_OPTIONS_AVAILABLE'].includes(selected.request.state) && <OptionsGrid options={selected.options} busy={busy} onChoose={choose} />}
        </>
      )}

      {!selected && (
        <div className="fc-card p-8 text-center">
          <p className="text-sm font-bold text-ink-800">No active care journeys yet</p>
          <p className="mt-1 text-sm text-ink-500">Start with a plain-language access request above. You can choose among feasible options before a referral is submitted.</p>
        </div>
      )}

      {journeys.length > 0 && (
        <section className="fc-card p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-base font-bold text-ink-900">Your care journeys</h2><Link href="/care" className="text-xs font-semibold text-brand-700 hover:underline">Open care hub</Link></div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {journeys.map((j) => (
              <button key={j.request.id} type="button" onClick={() => setActive(j)} className={`rounded-xl border p-3 text-left ${selected?.request.id === j.request.id ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-brand-300'}`}>
                <div className="flex items-center gap-2"><span className="fc-pill bg-ink-100 text-ink-700">{STATE_LABELS[j.request.state] ?? j.request.state}</span><span className="ml-auto text-[11px] text-ink-400">{new Date(j.request.updatedAt).toLocaleDateString('en-IN')}</span></div>
                <p className="mt-2 text-sm font-semibold text-ink-900">{j.request.specialty ?? j.request.serviceType}{j.request.location ? ` · ${j.request.location}` : ''}</p>
                <p className="mt-1 text-xs text-ink-500">{j.options.length} option{j.options.length === 1 ? '' : 's'} · next action: {nextAction(j.request.state)}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function OptionsGrid({ options, busy, onChoose }: { options: CareAccessOption[]; busy: boolean; onChoose: (o: CareAccessOption) => void }) {
  return (
    <section className="space-y-3">
      <div><p className="fc-eyebrow">Eligibility first</p><h2 className="mt-1 text-xl font-extrabold text-ink-900">Feasible care options</h2><p className="mt-1 text-sm text-ink-600">Options are filtered for recorded capability and patient constraints before ranking. No black-box score is used.</p></div>
      {options.length === 0 && <div className="fc-card p-6 text-sm text-ink-600">No capability-matched options were found from the available data. Try a broader location or ask a hospital directly.</div>}
      <div className="grid gap-3 lg:grid-cols-3">
        {options.map((option) => (
          <article key={option.id} className={`fc-card flex flex-col p-4 ${!option.eligible ? 'opacity-70' : ''}`}>
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h3 className="font-bold text-ink-900">{option.hospitalName}</h3><p className="mt-0.5 text-xs text-ink-500">{option.departmentName ?? 'Recorded service capability'}</p></div><span className={`fc-pill ${option.freshness === 'stale' || option.freshness === 'unavailable' ? 'bg-amber-50 text-amber-900' : 'bg-brand-50 text-brand-800'}`}>{option.freshnessLabel}</span></div>
            <div className="mt-3 space-y-1.5 text-xs text-ink-700"><p><b>Availability:</b> {option.slotLabel ?? 'No current bookable slot'}</p><p><b>Booking mode:</b> {option.slotType === 'instant' ? 'Instant confirmation' : option.slotType === 'waitlist' ? 'Waitlist only' : 'Hospital approval required'}</p><p><b>Distance:</b> {option.distanceKm == null ? 'Unavailable' : `${option.distanceKm.toFixed(1)} km estimate`}</p><p><b>Reported wait:</b> {option.queueWaitMinutes == null ? 'Not reported' : `~${option.queueWaitMinutes} min`}</p><p><b>Cost:</b> {option.costBand ? `${option.costBand} published band` : 'Cost information unavailable'}</p></div>
            <div className="mt-3 flex flex-wrap gap-1.5">{option.accessibility.slice(0, 4).map((a) => <span key={a} className="fc-pill bg-ink-100 text-ink-700 !text-[10px]">{a.replaceAll('-', ' ')}</span>)}{option.languages.slice(0, 4).map((l) => <span key={l} className="fc-pill bg-ink-100 text-ink-700 !text-[10px]">{l.toUpperCase()}</span>)}</div>
            <div className="mt-3 border-t border-ink-100 pt-3"><p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Why this appears</p><ul className="mt-1 space-y-1 text-xs leading-relaxed text-ink-600">{option.reasons.slice(0, 5).map((reason) => <li key={reason}>✓ {reason}</li>)}</ul></div>
            <button type="button" disabled={busy || !option.eligible} onClick={() => onChoose(option)} className="fc-btn-primary mt-4 w-full text-xs disabled:cursor-not-allowed disabled:opacity-50">{option.eligible ? option.slotType === 'instant' ? 'Select and book now' : option.slotType === 'waitlist' ? 'Join waitlist' : 'Request hospital approval' : 'Not feasible with current constraints'}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function JourneyCard({ payload, busy, onBook, onCancel, onClose, onTask }: { payload: JourneyPayload; busy: boolean; onBook: () => void; onCancel: () => void; onClose: () => void; onTask: (task: CareTask) => void }) {
  const { request } = payload;
  const stateIndex = STATE_ORDER.indexOf(request.state);
  const selectedOption = payload.options.find((o) => o.id === request.selectedOptionId);
  return (
    <section className="fc-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-3"><div><p className="fc-eyebrow">My Care Journey</p><h2 className="mt-1 text-xl font-extrabold text-ink-900">{request.specialty ?? request.serviceType}{request.location ? ` near ${request.location}` : ''}</h2></div><span className="fc-pill ml-auto bg-brand-50 text-brand-800">{STATE_LABELS[request.state] ?? request.state}</span></div>
      <div className="mt-5 overflow-x-auto pb-2"><ol className="flex min-w-[720px] items-center gap-0">{STATE_ORDER.map((state, i) => { const done = stateIndex >= i && stateIndex >= 0; return <li key={state} className="flex flex-1 items-center"><div className="flex min-w-0 flex-col items-center text-center"><span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${done ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-400'}`}>{done ? '✓' : i + 1}</span><span className={`mt-1 text-[10px] leading-tight ${done ? 'font-semibold text-ink-800' : 'text-ink-400'}`}>{STATE_LABELS[state]}</span></div>{i < STATE_ORDER.length - 1 && <span className={`h-0.5 flex-1 ${stateIndex > i ? 'bg-brand-400' : 'bg-ink-200'}`} />}</li>; })}</ol></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-ink-50 p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">What is happening now?</p><p className="mt-1 text-sm font-semibold text-ink-900">{STATE_LABELS[request.state] ?? request.state}</p><p className="mt-1 text-xs leading-relaxed text-ink-600">{nextAction(request.state)}</p></div><div className="rounded-xl border border-ink-200 p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Selected option</p><p className="mt-1 text-sm font-semibold text-ink-900">{selectedOption?.hospitalName ?? 'No hospital selected yet'}</p><p className="mt-1 text-xs text-ink-600">{selectedOption?.slotLabel ?? 'Choose a feasible option to continue.'}</p>{request.queueId && <p className="mt-2 text-xs font-bold text-brand-800">Queue ID: {request.queueId}{request.queuePosition ? ` · position ${request.queuePosition}` : ''}</p>}{request.approvalDeadline && <p className="mt-1 text-xs text-amber-800">Approval deadline: {new Date(request.approvalDeadline).toLocaleString('en-IN')}</p>}</div></div>
      {request.state === 'SLOT_OFFERED' && <div className="mt-4 rounded-xl bg-brand-50 p-4"><p className="text-sm font-bold text-brand-900">A slot is available for your selected hospital.</p><p className="mt-1 text-xs text-brand-800">Booking sends a request to the hospital. It is not a guarantee until the hospital confirms it.</p><button type="button" disabled={busy} onClick={onBook} className="fc-btn-primary mt-3 text-xs disabled:opacity-50">{busy ? 'Sending…' : 'Request this slot'}</button></div>}
      {['REQUESTED', 'SCREENED', 'OPTIONS_OFFERED'].includes(request.state) && <p className="mt-4 text-xs text-ink-500">Next action: choose a feasible hospital option. FlowCare will not submit a referral before you choose.</p>}
      {['REFERRAL_SUBMITTED', 'ACKNOWLEDGED', 'ACCEPTED', 'BOOKED', 'REMINDER'].includes(request.state) && <p className="mt-4 text-xs text-ink-600">Next action: {nextAction(request.state)}</p>}
      {request.state === 'FOLLOW_UP_OPEN' && payload.tasks.filter((t) => t.status !== 'completed').map((task) => <div key={task.id} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-4"><div className="min-w-0 flex-1"><p className="text-sm font-bold text-amber-950">{task.title}</p><p className="mt-1 text-xs text-amber-900">{task.description}</p></div><button type="button" disabled={busy} onClick={() => onTask(task)} className="fc-btn-secondary !border-amber-300 !bg-white text-xs">Mark done</button></div>)}
      {request.state === 'FOLLOW_UP_OPEN' && payload.tasks.length > 0 && payload.tasks.every((t) => t.status === 'completed') && <div className="mt-4 rounded-xl bg-brand-50 p-4"><p className="text-sm font-bold text-brand-900">Follow-up task completed</p><p className="mt-1 text-xs text-brand-800">Close the administrative care loop when no further coordination is needed.</p><button type="button" disabled={busy} onClick={onClose} className="fc-btn-primary mt-3 text-xs">Close care loop</button></div>}
      {!['CLOSED', 'CANCELLED', 'NO_SHOW', 'SERVICE_COMPLETED'].includes(request.state) && <button type="button" disabled={busy} onClick={onCancel} className="mt-4 text-xs font-semibold text-ink-500 underline underline-offset-2 hover:text-rose-700">Cancel this care request</button>}
    </section>
  );
}

function nextAction(state: string): string {
  const map: Record<string, string> = { REQUESTED: 'FlowCare is preparing a structured access request.', SCREENED: 'Options are being checked for capability and freshness.', OPTIONS_OFFERED: 'Choose a hospital option.', PATIENT_SELECTED: 'Choose a booking mode to continue.', REFERRAL_SUBMITTED: 'Wait for the hospital to acknowledge the referral.', APPROVAL_PENDING: 'The hospital must decide before the approval deadline.', APPROVAL_EXPIRED: 'No decision arrived in time. Recovery options can be offered without deleting this history.', APPROVED: 'The hospital approved the request; confirm the offered slot.', REJECTED: 'The hospital declined this request; choose recovery options when available.', WAITLISTED: 'You are on the waitlist. The position is informational and may change.', ACKNOWLEDGED: 'The hospital is reviewing the referral.', INFO_REQUESTED: 'Provide the requested administrative information.', ACCEPTED: 'The hospital will offer or confirm a slot.', SLOT_OFFERED: 'Review and request the offered slot.', BOOKED: 'Booking confirmed. Check the details before travelling.', RESCHEDULE_REQUESTED: 'The hospital is reviewing your reschedule request.', RECOVERY_REQUIRED: 'The original path is blocked; alternatives are being prepared.', RECOVERY_OPTIONS_AVAILABLE: 'Choose an eligible alternative without losing the original history.', REBOOKED: 'Your recovery booking is being recorded.', REMINDER: 'Check the appointment details before travelling.', ARRIVED: 'The hospital is recording your visit.', SERVICE_COMPLETED: 'Check whether a follow-up is needed.', FOLLOW_UP_OPEN: 'Complete the open follow-up task.', CLOSED: 'No further action is open.', CANCELLED: 'This care request is cancelled.', NO_SHOW: 'Contact the hospital if you need to reschedule.' };
  return map[state] ?? 'Check the latest status for the next action.';
}
