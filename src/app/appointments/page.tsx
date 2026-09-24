import Link from 'next/link';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { IconCalendar, IconSearch } from '@/components/Icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My visits — FlowCare' };

/**
 * Existing FlowCare appointment surface (Phase 1), left intact. Phase 2 only
 * adds the entry points from discovery into this flow.
 */
export default async function AppointmentsPage() {
  const user = await getSession();
  const repo = await getRepo();

  if (!user) {
    return (
      <div className="fc-card mt-6 p-8 text-center">
        <p className="text-base font-bold">Sign in to see your visits</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">
          Your appointments, queue position and visit history live in your FlowCare account.
        </p>
        <Link href="/hospitals" className="fc-btn-secondary mt-4"><IconSearch width={16} height={16} /> Discover hospitals</Link>
      </div>
    );
  }

  const [appointments, hospitals] = await Promise.all([repo.listAppointments({ patientId: user.id }), repo.listHospitals()]);
  const byId = new Map(hospitals.map((h) => [h.id, h]));
  const upcoming = appointments
    .filter((a) => a.status === 'requested' || a.status === 'booked' || a.status === 'checked_in')
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const past = appointments.filter((a) => a.status === 'completed' || a.status === 'no_show' || a.status === 'cancelled');

  return (
    <div className="space-y-4 py-2">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-extrabold">My visits</h1>
          <p className="text-xs text-ink-500">Signed in as {user.name} ({user.role})</p>
        </div>
        <Link href="/hospitals" className="ml-auto fc-btn-primary text-xs"><IconSearch width={15} height={15} /> Find a hospital</Link>
      </header>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">Upcoming ({upcoming.length})</h2>
        <div className="mt-3 space-y-2">
          {upcoming.length === 0 && <p className="text-xs text-ink-500">No upcoming appointments.</p>}
          {upcoming.map((a) => (
            <Link
              key={a.id}
              href={`/appointments/${a.id}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 p-3 hover:bg-ink-50"
            >
              <IconCalendar width={16} height={16} className="text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{byId.get(a.hospitalId)?.name ?? a.hospitalId}</p>
                <p className="text-[11px] text-ink-500">
                  {a.departmentId.split(':dept:')[1] ?? 'Department'} · {new Date(a.scheduledFor).toLocaleString()}
                </p>
                {a.status === 'requested' && (
                  <p className="text-[11px] font-medium text-amber-800">
                    Requested — waiting for the hospital to confirm
                  </p>
                )}
              </div>
              <span
                className={
                  a.status === 'requested'
                    ? 'fc-pill bg-amber-50 text-amber-900'
                    : 'fc-pill bg-brand-50 text-brand-800'
                }
              >
                {a.status}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">Past visits ({past.length})</h2>
        <p className="mt-0.5 text-[11px] text-ink-500">
          Completed visits unlock the verified-visit review form on that hospital&apos;s profile.
        </p>
        <div className="mt-3 space-y-2">
          {past.length === 0 && <p className="text-xs text-ink-500">No past visits recorded.</p>}
          {past.slice(0, 12).map((a) => {
            const h = byId.get(a.hospitalId);
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{h?.name ?? a.hospitalId}</p>
                  <p className="text-[11px] text-ink-500">
                    {a.departmentId.split(':dept:')[1] ?? 'Department'} · {new Date(a.scheduledFor).toLocaleDateString()}
                  </p>
                </div>
                <span className="fc-pill bg-ink-100 text-ink-700">{a.status}</span>
                {a.status === 'completed' && h && (
                  <Link href={`/hospitals/${h.slug}#reviews`} className="fc-btn-secondary !min-h-[34px] !py-1 text-[11px]">Review visit</Link>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
