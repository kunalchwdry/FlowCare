import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell, Stat, StatusBadge } from '@/components/hospital/HospitalShell';
import { PendingState, NoPermission } from '@/components/hospital/PendingState';
import { AppointmentActions } from '@/components/hospital/AppointmentActions';
import { todaysQueue } from '@/lib/hospital/portalData';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Queue — FlowCare hospital portal' };

function time(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Today's operational queue.
 *
 * Not a separate system: this is today's appointments filtered to the
 * states that mean somebody is here or expected, moved with the same
 * transitions as everywhere else. There is deliberately no priority score
 * and no ordering by anything clinical — it is a reception desk tool, and
 * deciding who is seen first is a judgement for staff, not a number from us.
 */
export default async function HospitalQueue() {
  const gate = await requireHospitalPermission('queue:read', '/hospital/queue');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden') {
    return <NoPermission actor={gate.actor} needs={gate.needs} active="/hospital/queue" title="Queue" />;
  }

  const { actor } = gate;
  const repo = await getRepo();
  const [hospital, all, sessions] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    repo.listAppointments({ hospitalId: actor.hospitalId }),
    repo.listSessions([actor.hospitalId]),
  ]);

  const queue = todaysQueue(all);
  const waiting = queue.filter((a) => a.status === 'booked' || a.status === 'checked_in');
  const inRoom = queue.filter((a) => a.status === 'in_progress');
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = all.filter(
    (a) => a.status === 'completed' && (a.scheduledFor ?? '').slice(0, 10) === today,
  );
  const missedToday = all.filter(
    (a) => a.status === 'no_show' && (a.scheduledFor ?? '').slice(0, 10) === today,
  );

  const slotOptions = sessions
    .filter((s) => s.status === 'open')
    .slice(0, 40)
    .map((s) => ({ id: s.id, label: `${s.date} · ${s.startTime}–${s.endTime} · ${s.departmentId}` }));

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/queue"
      title="Queue"
      subtitle="Today only. Confirmed appointments appear here as the day runs."
    >
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Expected / waiting" value={waiting.length} tone={waiting.length ? 'warn' : 'default'} />
        <Stat label="In consultation" value={inRoom.length} tone={inRoom.length ? 'good' : 'default'} />
        <Stat label="Completed today" value={doneToday.length} />
        <Stat label="Not attended" value={missedToday.length} tone="muted" />
      </section>

      {queue.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-ink-700">Nobody in the queue</p>
          <p className="mt-1 text-xs text-ink-500">
            Patients appear here once an appointment is confirmed for today, or when they are
            checked in at the desk.
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="px-4 py-2 font-semibold">Patient</th>
                <th className="px-4 py-2 font-semibold">Department</th>
                <th className="px-4 py-2 font-semibold">Time</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Move</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {queue.map((a, i) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-3 font-semibold tabular-nums text-ink-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-ink-900">
                      {a.patientName || <span className="text-ink-400">Name not given</span>}
                    </p>
                    <p className="font-mono text-[11px] text-ink-500">{a.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {a.departmentName ?? a.departmentId.split(':dept:')[1] ?? a.departmentId}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-700">{time(a.scheduledFor)}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
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

      <p className="mt-4 text-xs text-ink-500">
        Order is by appointment time. FlowCare does not rank patients by urgency — who is seen
        next is a clinical judgement, not something this screen should decide.
      </p>
    </HospitalShell>
  );
}
