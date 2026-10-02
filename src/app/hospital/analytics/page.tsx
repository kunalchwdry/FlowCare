import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell, Stat, NoData } from '@/components/hospital/HospitalShell';
import { PendingState, NoPermission } from '@/components/hospital/PendingState';
import { computeMetrics } from '@/lib/hospital/metrics';
import { buildFunnel, demandByDepartment, demandByHour, summariseReviews } from '@/lib/hospital/portalData';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics — FlowCare hospital portal' };

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <li className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-sm text-ink-700" title={label}>{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 text-right text-sm font-semibold tabular-nums text-ink-800">{value}</span>
    </li>
  );
}

/**
 * This hospital's own activity.
 *
 * Every figure is counted from stored appointments, events and reviews. Where
 * the underlying rows do not exist the page says so instead of printing a
 * zero, because "nothing happened" and "we never recorded it" are different
 * facts and only one of them is actionable.
 *
 * There is no overall score and no comparison with other hospitals. A single
 * number combining waiting times and staff manner reads as a verdict on
 * clinical quality, which none of this data supports.
 */
export default async function HospitalAnalytics() {
  const gate = await requireHospitalPermission('appointments:read', '/hospital/analytics');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden')
    return <NoPermission actor={gate.actor} needs={gate.needs} active="/hospital/analytics" title="Analytics" />;

  const { actor } = gate;
  const repo = await getRepo();
  const [hospital, appts, reviews] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    repo.listAppointments({ hospitalId: actor.hospitalId }),
    repo.listReviews({ hospitalId: actor.hospitalId }),
  ]);
  const eventLists = await Promise.all(appts.map((a) => repo.listAppointmentEvents(a.id)));
  const events = eventLists.flat();

  const m = computeMetrics(appts, events);
  const funnel = buildFunnel(appts, events);
  const byDept = demandByDepartment(appts);
  const byHour = demandByHour(appts);
  const rev = summariseReviews(reviews);

  const funnelRows = [
    ['Requested', funnel.requested],
    ['Confirmed', funnel.confirmed],
    ['Checked in', funnel.checkedIn],
    ['Completed', funnel.completed],
  ] as const;

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/analytics"
      title="Analytics"
      subtitle="Your own activity, counted from stored records. Nothing here is estimated."
    >
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Appointments" value={appts.length} />
        <Stat label="Completed" value={m.completed} tone="good" />
        <Stat label="Cancelled" value={m.cancelled} tone="muted" />
        <Stat label="Not attended" value={m.noShow} tone="muted" />
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-3">
        {m.avgConfirmationMinutes === null ? (
          <NoData what="Average time to confirm appears once requests have been accepted here." />
        ) : (
          <Stat label="Average time to confirm" value={`${m.avgConfirmationMinutes} min`} hint="Request to acceptance" />
        )}
        {m.cancellationRate === null ? (
          <NoData what="Cancellation rate appears once appointments have finished." />
        ) : (
          <Stat label="Cancellation rate" value={`${m.cancellationRate}%`} hint="Of finished appointments" />
        )}
        {m.noShowRate === null ? (
          <NoData what="Non-attendance rate appears once appointments have finished." />
        ) : (
          <Stat label="Non-attendance rate" value={`${m.noShowRate}%`} hint="Of finished appointments" />
        )}
      </section>

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Appointment funnel</h2>
      {funnel.requested === 0 ? (
        <div className="mt-2"><NoData what="The funnel fills in as patients request appointments and you work through them." /></div>
      ) : (
        <div className="mt-2 rounded-xl border border-ink-200 bg-white p-4">
          <ul className="space-y-2">
            {funnelRows.map(([label, v]) => <Bar key={label} label={label} value={v} max={funnel.requested} />)}
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            Counted from recorded events, so an appointment that is now completed still counts at
            every stage it passed through.
          </p>
        </div>
      )}

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Demand by department</h2>
      {byDept.length === 0 ? (
        <div className="mt-2"><NoData what="Department demand appears once appointments have been requested." /></div>
      ) : (
        <div className="mt-2 rounded-xl border border-ink-200 bg-white p-4">
          <ul className="space-y-2">
            {byDept.map((d) => (
              <Bar key={d.id} label={d.id.split(':dept:')[1] ?? d.id} value={d.count} max={byDept[0].count} />
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Busiest times</h2>
      {byHour.length === 0 ? (
        <div className="mt-2"><NoData what="Busy periods appear once there are appointments to count." /></div>
      ) : (
        <div className="mt-2 rounded-xl border border-ink-200 bg-white p-4">
          <ul className="space-y-2">
            {byHour.map((h) => (
              <Bar
                key={h.hour}
                label={`${String(h.hour).padStart(2, '0')}:00`}
                value={h.count}
                max={Math.max(...byHour.map((x) => x.count))}
              />
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-ink-500">Patient experience</h2>
      {rev.count === 0 ? (
        <div className="mt-2"><NoData what="Review dimensions appear once patients with completed visits leave feedback." /></div>
      ) : (
        <section className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Overall" value={rev.overall ?? '—'} hint={`${rev.count} reviews`} />
          <Stat label="Waiting" value={rev.waiting ?? '—'} />
          <Stat label="Staff" value={rev.staff ?? '—'} />
          <Stat label="Appointment" value={rev.appointment ?? '—'} />
          <Stat label="Facility" value={rev.facility ?? '—'} />
        </section>
      )}

      <p className="mt-6 text-xs text-ink-500">
        FlowCare does not produce a hospital score or a ranking. These are your own operational
        figures, shown so you can act on them — not a judgement on the care you provide.
      </p>
    </HospitalShell>
  );
}
