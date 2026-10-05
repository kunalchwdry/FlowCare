import Link from 'next/link';
import { getRepo } from '@/lib/data';
import { computeAvailability } from '@/lib/discovery/availability';
import { label } from '@/lib/discovery/filters';
import { getSession } from '@/lib/auth/session';
import { SlotPicker } from '@/components/SlotPicker';
import { formatDateTime } from '@/lib/time';
import { PatientTrafficPanel } from '@/components/PatientTraffic';

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

  const [sessions, trafficRows] = await Promise.all([
    repo.listSessions([hospital.id]),
    repo.listPatientTraffic([hospital.id]),
  ]);
  const traffic = trafficRows[0];
  const availability = computeAvailability(hospital.id, sessions);
  const depts = hospital.departments.filter((d) => d.active);
  const todayKey = availability.computedAt.slice(0, 10);
  const horizonKey = new Date(new Date(`${todayKey}T00:00:00Z`).getTime() + availability.windowDays * 86_400_000)
    .toISOString().slice(0, 10);
  const matchesDepartment = (session: (typeof sessions)[number], dept: (typeof depts)[number]) =>
    session.departmentId === dept.id || session.departmentId.endsWith(`:dept:${dept.specialty}`);
  const freeInWindow = (dept: (typeof depts)[number]) => sessions
    .filter((s) => matchesDepartment(s, dept))
    .filter((s) => s.date >= todayKey && s.date <= horizonKey)
    .filter((s) => s.status === 'open' && s.capacity > s.booked)
    .reduce((total, s) => total + (s.capacity - s.booked), 0);
  // A legacy link may still contain the specialty slug. Prefer the matching
  // department with actual published supply when duplicate legacy names exist.
  const selectedDepartment = department
    ? depts
        .filter((d) => d.id === department || d.specialty === department)
        .sort((a, b) => freeInWindow(b) - freeInWindow(a))[0] ?? null
    : null;
  const open = sessions
    .filter((s) => s.status === 'open' && s.capacity > s.booked)
    .filter((s) => s.date >= todayKey && s.date <= horizonKey)
    .filter((s) => !selectedDepartment || matchesDepartment(s, selectedDepartment))
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
    .slice(0, 12);
  const noDepartments = depts.length === 0;
  const hasInstantSlots = open.some((s) => s.slotType === 'instant');

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
          {noDepartments
            ? 'No appointment request has been sent yet. This hospital has not published a department or appointment slot in FlowCare.'
            : hasInstantSlots
              ? 'Published slots are requests until the hospital confirms them. Approval-required slots follow the same hospital confirmation process.'
              : 'You are asking the hospital for a slot. It is a request until the hospital confirms it — FlowCare cannot confirm an appointment on a hospital\'s behalf.'}
        </p>
        <div className="mt-4">
          <PatientTrafficPanel traffic={traffic} hospitalId={hospital.id} autoRefresh />
        </div>
      </header>

      {noDepartments ? (
        <section className="fc-card border-amber-200 bg-amber-50 p-5" role="status">
          <h2 className="text-sm font-bold text-amber-950">Appointments are not open at this hospital yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900">
            The hospital has not configured a department or published a slot. FlowCare will not invent one,
            so there is nothing you can select and no request has reached the hospital.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/care-access" className="fc-btn-primary text-xs">Describe what care you need</Link>
            <Link href={`/hospitals/${hospital.slug}`} className="fc-btn-secondary text-xs">Back to hospital profile</Link>
          </div>
          <p className="mt-3 text-[11px] text-amber-800">
            Hospital staff can make this bookable from Hospital portal → Operations by adding a department and
            publishing a real slot.
          </p>
        </section>
      ) : (
        <>
          <section className="fc-card p-5">
            <h2 className="text-sm font-bold">Choose a department</h2>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {depts.map((d) => (
                <Link
                  key={d.id}
                  href={`/appointments/new?hospital=${hospital.slug}&department=${encodeURIComponent(d.id)}`}
                  className={selectedDepartment?.id === d.id ? 'fc-chip-on' : 'fc-chip-off'}
                >
                  {d.name}
                  {freeInWindow(d) > 0 ? (
                    <span className="font-bold text-brand-700">{freeInWindow(d)}</span>
                  ) : (
                    <span className="opacity-50">0</span>
                  )}
                </Link>
              ))}
            </div>
          </section>

          <section className="fc-card p-5">
            <h2 className="text-sm font-bold">
              Choose a date and time {selectedDepartment && <span className="text-ink-500">· {selectedDepartment.name}</span>}
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              FlowCare session data, computed {formatDateTime(availability.computedAt)}.
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
                  departmentLabel: depts.find((d) => matchesDepartment(s, d))?.name ?? label(s.departmentId.split(':dept:')[1] ?? ''),
                  slotType: s.slotType ?? 'approval_required',
                }))}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
