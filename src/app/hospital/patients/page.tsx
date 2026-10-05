import Link from 'next/link';
import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell, Stat, StatusBadge } from '@/components/hospital/HospitalShell';
import { PendingState, NoPermission } from '@/components/hospital/PendingState';
import { summarisePatients } from '@/lib/hospital/portalData';
import { formatDate } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Patients — FlowCare hospital portal' };

const d = (iso: string) => formatDate(iso);

/**
 * Patients, strictly in the context of appointments at THIS hospital.
 *
 * Deliberately not a patient record. Staff see the visits somebody has had
 * here and nothing more — no other hospital's appointments, no care
 * partners, no follow-ups, no saved hospitals, no AI keys. Those belong to
 * the patient, and working at a hospital is not authority to read them.
 *
 * Patient ids are shown rather than names because the appointment row
 * carries a display name only where the patient supplied one for that
 * booking; inventing an identity from elsewhere would be guessing.
 */
export default async function HospitalPatients() {
  const gate = await requireHospitalPermission('appointments:read', '/hospital/patients');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden')
    return <NoPermission actor={gate.actor} needs={gate.needs} active="/hospital/patients" title="Patients" />;

  const { actor } = gate;
  const repo = await getRepo();
  const [hospital, appts] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    repo.listAppointments({ hospitalId: actor.hospitalId }),
  ]);
  const patients = summarisePatients(appts);

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/patients"
      title="Patients"
      subtitle="People who have appointments at this hospital."
    >
      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Patients seen or booked" value={patients.length} />
        <Stat label="Appointments total" value={appts.length} />
        <Stat label="Returning" value={patients.filter((p) => p.appointments.length > 1).length}
              hint="More than one appointment here" />
      </section>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs text-amber-900">
          This page shows only what happened at this hospital. A patient&apos;s other visits,
          care partners and personal records are not visible here, and working here does not
          grant access to them.
        </p>
      </div>

      {patients.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-ink-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-ink-700">No patients yet</p>
          <p className="mt-1 text-xs text-ink-500">
            Someone appears here as soon as they request their first appointment with you.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-200 bg-white">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="border-b border-ink-200 bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Patient</th>
                <th className="px-4 py-2 font-semibold">Appointments</th>
                <th className="px-4 py-2 font-semibold">First</th>
                <th className="px-4 py-2 font-semibold">Most recent</th>
                <th className="px-4 py-2 font-semibold">Latest status</th>
                <th className="px-4 py-2 font-semibold">Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {patients.map((p) => (
                <tr key={p.patientId}>
                  <td className="px-4 py-3 font-mono text-xs text-ink-700">{p.patientId}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-700">
                    {p.appointments.length}
                    <span className="ml-2 text-xs text-ink-500">
                      {p.completed} completed{p.upcoming ? `, ${p.upcoming} upcoming` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">{d(p.first)}</td>
                  <td className="px-4 py-3 text-xs text-ink-500">{d(p.last)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.appointments.at(-1)!.status} /></td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/hospital/patients/${p.appointments.at(-1)!.id}`}
                      className="text-xs font-semibold text-brand-700 hover:underline"
                    >
                      Reliability &amp; visits
                    </Link>
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
