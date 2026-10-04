'use client';

import { useEffect, useState } from 'react';
import type { OperationalDepartment, OperationalService, OperationalSlot, Provider, ProviderSchedule } from '@/lib/operations/types';

interface Payload { departments: OperationalDepartment[]; services: OperationalService[]; providers: Provider[]; schedules: ProviderSchedule[]; slots: OperationalSlot[]; source: string; updatedAt: string }

export function HospitalOperationsPanel({ canSlots, canExport }: { canSlots: boolean; canExport: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [departmentName, setDepartmentName] = useState('');
  const [serviceLabel, setServiceLabel] = useState('');
  const [serviceSlug, setServiceSlug] = useState('');
  const [queueOrderRule, setQueueOrderRule] = useState<'arrival_order' | 'scheduled_time' | 'manual'>('arrival_order');
  const [providerName, setProviderName] = useState('');
  const [providerDepartment, setProviderDepartment] = useState('');
  const [scheduleProvider, setScheduleProvider] = useState('');
  const [scheduleWeekday, setScheduleWeekday] = useState('1');
  const [scheduleStart, setScheduleStart] = useState('09:00');
  const [scheduleEnd, setScheduleEnd] = useState('17:00');
  const [slotDepartment, setSlotDepartment] = useState('');
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [slotType, setSlotType] = useState<'instant' | 'approval_required' | 'waitlist'>('approval_required');
  const [capacity, setCapacity] = useState('1');

  async function load() {
    const res = await fetch('/api/hospital/operations', { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) { setError(json?.error?.message ?? 'Could not load operational configuration.'); return; }
    const next = json.data as Payload; setData(next);
    if (!providerDepartment) setProviderDepartment(next.departments[0]?.id ?? '');
    if (!slotDepartment) setSlotDepartment(next.departments[0]?.id ?? '');
    if (!scheduleProvider) setScheduleProvider(next.providers[0]?.id ?? '');
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(resource: 'department' | 'service' | 'provider' | 'schedule' | 'slot', body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/hospital/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource, ...body }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Could not save configuration.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save configuration.'); }
    finally { setBusy(false); }
  }

  async function createSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!slotStart || !slotEnd || !slotDepartment) return;

    const startsAt = new Date(slotStart);
    const endsAt = new Date(slotEnd);
    const now = new Date();
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      setError('Choose valid start and end date-times.');
      return;
    }
    if (startsAt <= now) {
      setError('The slot must start in the future.');
      return;
    }
    if (endsAt <= startsAt) {
      setError('The slot end must be later than its start.');
      return;
    }
    const seats = Number(capacity);
    if (!Number.isInteger(seats) || seats < 1 || seats > 1000) {
      setError('Capacity must be a whole number between 1 and 1000.');
      return;
    }

    await create('slot', {
      departmentId: slotDepartment,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      slotType,
      capacity: seats,
      waitlistEnabled: slotType === 'waitlist',
    });
  }

  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
    <div className="rounded-xl border border-ink-200 bg-white p-4 text-xs text-ink-600">Source: <b>{data?.source ?? 'loading'}</b> · Last read: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString('en-IN') : '—'}. Slot counts below are database/demo-simulated observations, not predictions.</div>
    <section className="grid gap-4 lg:grid-cols-3">
      <form className="fc-card p-4" onSubmit={(e) => { e.preventDefault(); void create('department', { name: departmentName, queueOrderRule }); }}><h2 className="text-sm font-bold text-ink-900">Add department</h2><input className="fc-input mt-3 w-full" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} placeholder="e.g. Orthopaedics" maxLength={160} /><select className="fc-input mt-2 w-full" value={queueOrderRule} onChange={(e) => setQueueOrderRule(e.target.value as typeof queueOrderRule)}><option value="arrival_order">Queue rule: arrival order</option><option value="scheduled_time">Queue rule: scheduled time</option><option value="manual">Queue rule: manual staff ordering</option></select><button disabled={busy || !departmentName.trim()} className="fc-btn-primary mt-3 text-xs">Create department</button></form>
      <form className="fc-card p-4" onSubmit={(e) => { e.preventDefault(); void create('service', { departmentId: providerDepartment || data?.departments[0]?.id, serviceSlug, label: serviceLabel }); }}><h2 className="text-sm font-bold text-ink-900">Add service</h2><select className="fc-input mt-3 w-full" value={providerDepartment} onChange={(e) => setProviderDepartment(e.target.value)}>{(data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><input className="fc-input mt-2 w-full" value={serviceLabel} onChange={(e) => setServiceLabel(e.target.value)} placeholder="Display label" maxLength={160} /><input className="fc-input mt-2 w-full" value={serviceSlug} onChange={(e) => setServiceSlug(e.target.value)} placeholder="service-slug" maxLength={120} /><button disabled={busy || !serviceLabel.trim() || !serviceSlug.trim()} className="fc-btn-primary mt-3 text-xs">Create service</button></form>
      <form className="fc-card p-4" onSubmit={(e) => { e.preventDefault(); void create('provider', { departmentId: providerDepartment, name: providerName }); }}><h2 className="text-sm font-bold text-ink-900">Add provider</h2><select className="fc-input mt-3 w-full" value={providerDepartment} onChange={(e) => setProviderDepartment(e.target.value)}>{(data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><input className="fc-input mt-2 w-full" value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Provider display name" maxLength={160} /><button disabled={busy || !providerName.trim() || !providerDepartment} className="fc-btn-primary mt-3 text-xs">Create provider</button></form>
      <form className="fc-card p-4" onSubmit={(e) => { e.preventDefault(); void create('schedule', { providerId: scheduleProvider, weekday: Number(scheduleWeekday), startsAt: scheduleStart, endsAt: scheduleEnd }); }}><h2 className="text-sm font-bold text-ink-900">Add provider schedule</h2><select className="fc-input mt-3 w-full" value={scheduleProvider} onChange={(e) => setScheduleProvider(e.target.value)}>{(data?.providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="mt-2 grid grid-cols-3 gap-2"><select aria-label="Schedule weekday" className="fc-input" value={scheduleWeekday} onChange={(e) => setScheduleWeekday(e.target.value)}>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => <option key={day} value={i}>{day}</option>)}</select><input aria-label="Schedule start time" type="time" className="fc-input" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} /><input aria-label="Schedule end time" type="time" className="fc-input" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} /></div><button disabled={busy || !scheduleProvider} className="fc-btn-primary mt-3 text-xs">Save schedule</button></form>
      <form className="fc-card p-4" onSubmit={(e) => void createSlot(e)}><h2 className="text-sm font-bold text-ink-900">Publish a slot</h2><select aria-label="Slot department" className="fc-input mt-3 w-full" value={slotDepartment} onChange={(e) => setSlotDepartment(e.target.value)}>{(data?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><p className="mt-2 text-[11px] text-ink-500">Choose a future date. End must be later than start.</p><div className="mt-1 grid grid-cols-2 gap-2"><input aria-label="Slot start date and time" type="datetime-local" className="fc-input" value={slotStart} onChange={(e) => setSlotStart(e.target.value)} /><input aria-label="Slot end date and time" type="datetime-local" className="fc-input" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} /></div><div className="mt-2 grid grid-cols-2 gap-2"><select aria-label="Slot booking mode" className="fc-input" value={slotType} onChange={(e) => setSlotType(e.target.value as typeof slotType)}><option value="instant">Instant</option><option value="approval_required">Approval required</option><option value="waitlist">Waitlist</option></select><input aria-label="Slot capacity" type="number" min="1" max="1000" className="fc-input" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity" /></div><button disabled={busy || !slotStart || !slotEnd || !slotDepartment || !canSlots} className="fc-btn-primary mt-3 text-xs">Publish slot</button></form>
    </section>
    <section className="fc-card p-4"><h2 className="text-sm font-bold text-ink-900">Services, providers and schedules</h2><div className="mt-3 flex flex-wrap gap-2">{(data?.services ?? []).map((service) => <span key={service.id} className="fc-pill bg-brand-50 text-brand-800">{service.label} · {service.serviceSlug}</span>)}</div><div className="mt-3 grid gap-2 md:grid-cols-2">{(data?.providers ?? []).map((provider) => <div key={provider.id} className="rounded-lg border border-ink-200 p-3 text-xs"><p className="font-bold text-ink-900">{provider.name}</p><p className="mt-1 text-ink-500">{provider.specialty ?? 'Specialty not recorded'} · {(data?.schedules ?? []).filter((s) => s.providerId === provider.id).length} schedule row(s)</p></div>)}</div>{!data?.providers.length && <p className="mt-2 text-sm text-ink-500">No providers configured yet.</p>}</section>
    <section className="fc-card overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4"><div><h2 className="text-sm font-bold text-ink-900">Actual slot supply</h2><p className="mt-1 text-xs text-ink-500">Booked capacity is read from the repository and tagged with its source.</p></div>{canExport && <div className="flex gap-2"><a className="fc-btn-secondary text-xs" href="/api/hospital/exports?format=csv">CSV export</a><a className="fc-btn-secondary text-xs" href="/api/hospital/exports?format=xlsx">Excel export</a></div>}</div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-ink-50 text-ink-500"><tr><th className="px-4 py-3">Starts</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Mode</th><th className="px-4 py-3">Capacity</th><th className="px-4 py-3">Updated/source</th></tr></thead><tbody>{(data?.slots ?? []).slice(0, 100).map((slot) => <tr key={slot.id} className="border-t border-ink-100"><td className="px-4 py-3 font-semibold text-ink-800">{new Date(slot.startsAt).toLocaleString('en-IN')}</td><td className="px-4 py-3 text-ink-700">{data?.departments.find((d) => d.id === slot.departmentId)?.name ?? slot.departmentId}</td><td className="px-4 py-3">{slot.slotType.replace('_', ' ')}</td><td className="px-4 py-3">{slot.booked}/{slot.capacity}</td><td className="px-4 py-3 text-ink-500">{slot.source} · {new Date(slot.updatedAt).toLocaleString('en-IN')}</td></tr>)}</tbody></table>{!data?.slots.length && <p className="p-5 text-sm text-ink-500">No future slots are published for this hospital.</p>}</div></section>
  </div>;
}
