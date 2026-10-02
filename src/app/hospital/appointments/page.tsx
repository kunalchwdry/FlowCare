import Link from 'next/link';
import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell, StatusBadge } from '@/components/hospital/HospitalShell';
import { PendingState } from '@/components/hospital/PendingState';
import { AppointmentActions } from '@/components/hospital/AppointmentActions';
import type { Appointment } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Appointments — FlowCare hospital portal' };

const TABS = [
  { id: 'pending', label: 'Pending requests', match: ['requested'] },
  { id: 'awaiting', label: 'Awaiting patient', match: ['reschedule_proposed'] },
  { id: 'confirmed', label: 'Confirmed', match: ['booked'] },
  { id: 'today', label: 'Today', match: [] },
  { id: 'completed', label: 'Completed', match: ['completed'] },
  { id: 'closed', label: 'Cancelled & declined', match: ['cancelled', 'rejected', 'no_show'] },
] as const;

function fmt(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default async function HospitalAppointments({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const gate = await requireHospitalPermission('appointments:read', '/hospital/appointments');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden') {
    return (
      <HospitalShell
        actor={gate.actor}
        hospitalName="Your hospital"
        active="/hospital/appointments"
        title="Appointments"
      >
        <div className="rounded-xl border border-ink-200 bg-white p-6">
          <p className="text-sm font-semibold text-ink-800">You do not have access to this page</p>
          <p className="mt-1 text-sm text-ink-600">
            It needs the <code className="font-mono text-xs">{gate.needs}</code> permission. A
            manager at your hospital can grant it.
          </p>
        </div>
      </HospitalShell>
    );
  }

  const { actor } = gate;
  const { tab = 'pending', q = '' } = await searchParams;
  const repo = await getRepo();

  // Scoped read. The hospital id comes from the caller's membership, never
  // from the query string, so there is no parameter to tamper with.
  const [hospital, all, sessions] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    repo.listAppointments({ hospitalId: actor.hospitalId }),
    repo.listSessions([actor.hospitalId]),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  let rows: Appointment[] =
    active.id === 'today'
      ? all.filter((a) => (a.scheduledFor ?? '').slice(0, 10) === today)
      : all.filter((a) => (active.match as readonly string[]).includes(a.status));

  const needle = q.trim().toLowerCase();
  if (needle) {
    rows = rows.filter(
      (a) => a.id.toLowerCase().includes(needle) || a.departmentId.toLowerCase().includes(needle),
    );
  }
  rows.sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''));

  const slotOptions = sessions
    .filter((s) => s.status === 'open')
    .slice(0, 40)
    .map((s) => ({ id: s.id, label: `${s.date} · ${s.startTime}–${s.endTime} · ${s.departmentId}` }));

  const count = (t: (typeof TABS)[number]) =>
    t.id === 'today'
      ? all.filter((a) => (a.scheduledFor ?? '').slice(0, 10) === today).length
      : all.filter((a) => (t.match as readonly string[]).includes(a.status)).length;

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/appointments"
      title="Appointments"
      subtitle="Requests stay pending until someone here accepts them."
    >
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/hospital/appointments?tab=${t.id}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              t.id === active.id ? 'bg-brand-600 text-white' : 'border border-ink-300 bg-white text-ink-700 hover:bg-ink-50'
            }`}
          >
            {t.label} <span className="tabular-nums opacity-70">{count(t)}</span>
          </Link>
        ))}
      </div>

      <form className="mt-3 flex gap-2" action="/hospital/appointments">
        <input type="hidden" name="tab" value={active.id} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by appointment ID or department"
          className="w-full max-w-md rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="fc-btn-secondary !py-2 text-sm">Search</button>
      </form>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-ink-700">Nothing here</p>
          <p className="mt-1 text-xs text-ink-500">
            {active.id === 'pending'
              ? 'No appointment requests are waiting. New ones appear as patients send them.'
              : `No appointments in “${active.label}”.`}
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Patient</th>
                <th className="px-4 py-2 font-semibold">Appointment</th>
                <th className="px-4 py-2 font-semibold">Department</th>
                <th className="px-4 py-2 font-semibold">Scheduled for</th>
                <th className="px-4 py-2 font-semibold">Requested</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-3">
                    {/* The name given at booking — what reception calls out.
                        Operational only, not an identity record. */}
                    <p className="font-semibold text-ink-900">
                      {a.patientName || <span className="text-ink-400">Name not given</span>}
                    </p>
                    {a.reason && (
                      <p className="mt-0.5 max-w-xs text-xs text-ink-500">“{a.reason}”</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[11px] text-ink-600">{a.id.slice(0, 8)}…</span>
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {a.departmentName ?? a.departmentId.split(':dept:')[1] ?? a.departmentId}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {fmt(a.scheduledFor)}
                    {a.proposedFor && (
                      <p className="mt-0.5 text-xs font-semibold text-amber-700">
                        Proposed: {fmt(a.proposedFor)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">{fmt(a.requestedAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.status} />
                    {a.decisionReason && (
                      <p className="mt-1 max-w-xs text-xs text-ink-500">{a.decisionReason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <AppointmentActions
                      appointmentId={a.id}
                      status={a.status}
                      version={a.version ?? 1}
                      permissions={actor.permissions}
                      slots={slotOptions}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </HospitalShell>
  );
}
