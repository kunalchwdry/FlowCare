import Link from 'next/link';
import { requireHospital } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { computeMetrics } from '@/lib/hospital/metrics';
import { HospitalShell, Stat, NoData } from '@/components/hospital/HospitalShell';
import { PendingState } from '@/components/hospital/PendingState';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Hospital dashboard — FlowCare' };

export default async function HospitalDashboard() {
  const gate = await requireHospital('/hospital');
  if (gate.kind !== 'ok') return <PendingState user={gate.user} />;
  const { actor } = gate;

  const repo = await getRepo();
  const [hospital, appointments] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    repo.listAppointments({ hospitalId: actor.hospitalId }),
  ]);

  // Events are per-appointment; gather only this hospital's.
  const eventLists = await Promise.all(
    appointments.map((a) => repo.listAppointmentEvents(a.id)),
  );
  const events = eventLists.flat();
  const m = computeMetrics(appointments, events);

  const needsAction = m.pending + m.awaitingPatient;

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital"
      title="Today"
      subtitle={new Date().toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })}
      actions={
        needsAction > 0 ? (
          <Link href="/hospital/appointments?tab=pending" className="fc-btn-primary !py-2 text-sm">
            {needsAction} need{needsAction === 1 ? 's' : ''} your attention
          </Link>
        ) : null
      }
    >
      {/* Attention panel first: a dashboard that is only informational wastes
          the one glance a receptionist gives it. */}
      {needsAction > 0 ? (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">Waiting on you</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {m.pending > 0 && (
              <li>
                <Link href="/hospital/appointments?tab=pending" className="underline underline-offset-2">
                  {m.pending} appointment request{m.pending === 1 ? '' : 's'} to accept or decline
                </Link>
              </li>
            )}
            {m.awaitingPatient > 0 && (
              <li>
                {m.awaitingPatient} patient{m.awaitingPatient === 1 ? ' has' : 's have'} not yet
                answered a proposed time
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div className="mb-5 rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-800">Nothing is waiting on you</p>
          <p className="mt-1 text-xs text-ink-500">
            New appointment requests will appear here as patients send them.
          </p>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Scheduled today" value={m.todayTotal} />
        <Stat label="Pending requests" value={m.pending} tone={m.pending ? 'warn' : 'default'}
              hint="Not yet accepted or declined" />
        <Stat label="Confirmed" value={m.confirmed} tone="good" />
        <Stat label="In the building" value={m.inQueue} hint="Checked in or in consultation" />
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Completed" value={m.completed} />
        <Stat label="Cancelled" value={m.cancelled} tone="muted" />
        <Stat label="Declined" value={m.rejected} tone="muted" />
        <Stat label="Not attended" value={m.noShow} tone="muted" />
      </section>

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">
        Operational indicators
      </h2>
      <section className="mt-2 grid gap-3 sm:grid-cols-3">
        {m.avgConfirmationMinutes === null ? (
          <NoData what="Average confirmation time appears once requests have been accepted here." />
        ) : (
          <Stat
            label="Average time to confirm"
            value={`${m.avgConfirmationMinutes} min`}
            hint="From request to acceptance"
          />
        )}
        {m.cancellationRate === null ? (
          <NoData what="Cancellation rate appears once appointments have finished." />
        ) : (
          <Stat label="Cancellation rate" value={`${m.cancellationRate}%`} hint="Of finished appointments" />
        )}
        {m.noShowRate === null ? (
          <NoData what="Non-attendance rate appears once appointments have finished." />
        ) : (
          <Stat label="Not attended" value={`${m.noShowRate}%`} hint="Of finished appointments" />
        )}
      </section>

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">
        Most requested departments
      </h2>
      {m.topDepartments.length === 0 ? (
        <div className="mt-2">
          <NoData what="Department demand appears once appointments have been requested." />
        </div>
      ) : (
        <div className="mt-2 rounded-xl border border-ink-200 bg-white p-4">
          <ul className="space-y-2">
            {m.topDepartments.map((d) => {
              const pct = Math.round((d.count / m.topDepartments[0].count) * 100);
              return (
                <li key={d.departmentId} className="flex items-center gap-3">
                  <span className="w-48 shrink-0 truncate text-sm text-ink-700">{d.departmentId}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-8 text-right text-sm font-semibold tabular-nums text-ink-800">
                    {d.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </HospitalShell>
  );
}
