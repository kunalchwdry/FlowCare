import Link from 'next/link';
import { getRepo } from '@/lib/data';
import { computeAvailability } from '@/lib/discovery/availability';
import { label } from '@/lib/discovery/filters';
import { getSession } from '@/lib/auth/session';
import { SlotPicker } from '@/components/SlotPicker';

export const dynamic = 'force-dynamic';

/**
 * Entry point from discovery into the EXISTING FlowCare appointment workflow.
 * This page hands over hospital + department context; the booking, payment,
 * queue and confirmation steps remain the Phase 1 implementation.
 */
export default async function NewAppointmentPage({
  searchParams,
}: { searchParams: Promise<{ hospital?: string; department?: string }> }) {
  const { hospital: slug, department } = await searchParams;
  const repo = await getRepo();
  const user = await getSession();
  const hospital = slug ? await repo.getHospital(slug) : null;

  if (!hospital) {
    return (
      <div className="fc-card mt-6 p-8 text-center">
        <p className="text-base font-bold">Choose a hospital first</p>
        <Link href="/hospitals" className="fc-btn-primary mt-4">Discover hospitals</Link>
      </div>
    );
  }

  const sessions = await repo.listSessions([hospital.id]);
  const availability = computeAvailability(hospital.id, sessions);
  const depts = hospital.departments.filter((d) => d.active);
  const open = sessions
    .filter((s) => s.status === 'open' && s.capacity > s.booked)
    .filter((s) => !department || s.departmentId.endsWith(`:dept:${department}`))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  return (
    <div className="space-y-4 py-2">
      <nav className="text-xs text-ink-500">
        <Link href="/hospitals" className="hover:underline">Discover</Link> /{' '}
        <Link href={`/hospitals/${hospital.slug}`} className="hover:underline">{hospital.name}</Link> /{' '}
        <span className="font-medium text-ink-700">Book</span>
      </nav>

      <header className="fc-card p-5">
        <h1 className="text-lg font-extrabold">Book an appointment</h1>
        <p className="mt-0.5 text-sm text-ink-600">{hospital.name} — {hospital.addressLine}</p>
        <p className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-[11px] text-brand-900 ring-1 ring-brand-200">
          You are asking the hospital for a slot. It is a request until the hospital confirms it — FlowCare cannot
          confirm an appointment on a hospital's behalf. Queue tracking and check-in remain the Phase 1 workflow.
        </p>
      </header>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">Choose a department</h2>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {depts.map((d) => (
            <Link
              key={d.id}
              href={`/appointments/new?hospital=${hospital.slug}&department=${d.specialty}`}
              className={department === d.specialty ? 'fc-chip-on' : 'fc-chip-off'}
            >
              {d.name}
              {availability.bySpecialty[d.specialty] ? (
                <span className="font-bold text-brand-700">{availability.bySpecialty[d.specialty]}</span>
              ) : (
                <span className="opacity-50">0</span>
              )}
            </Link>
          ))}
        </div>
      </section>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">
          Available sessions {department && <span className="text-ink-500">· {label(department)}</span>}
        </h2>
        <p className="mt-0.5 text-[11px] text-ink-500">
          FlowCare session data, computed {new Date(availability.computedAt).toLocaleString()}.
        </p>
        <div className="mt-3">
          <SlotPicker
            signedIn={Boolean(user)}
            windowDays={availability.windowDays}
            slots={open.map((s) => ({
              id: s.id,
              date: s.date,
              startTime: s.startTime,
              endTime: s.endTime,
              capacity: s.capacity,
              booked: s.booked,
              departmentLabel: label(s.departmentId.split(':dept:')[1] ?? ''),
            }))}
          />
        </div>
      </section>
    </div>
  );
}
