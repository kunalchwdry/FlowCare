import { notFound } from 'next/navigation';
import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { HospitalShell } from '@/components/hospital/HospitalShell';
import { PendingState, NoPermission } from '@/components/hospital/PendingState';
import { ReliabilityCard, ReliabilityErrorCard } from '@/components/ReliabilityCard';
import { VerifiedVisitHistory } from '@/components/VerifiedVisitHistory';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Patient context — FlowCare hospital portal' };

export default async function HospitalPatientContext({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const gate = await requireHospitalPermission('appointments:read', '/hospital/patients');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden') {
    return <NoPermission actor={gate.actor} needs={gate.needs} active="/hospital/patients" title="Patient context" />;
  }

  const { appointmentId } = await params;
  const repo = await getRepo();
  const appointment = await repo.getAppointment(appointmentId);
  // Scope is checked before loading the profile. In particular, a staff
  // member cannot turn this route into a global patient-id search.
  if (!appointment || appointment.hospitalId !== gate.actor.hospitalId) notFound();

  const hospital = await repo.getHospital(gate.actor.hospitalId);
  let profile = null;
  let profileError = false;
  try {
    profile = await repo.getHospitalPatientProfile(appointment.id, gate.actor.hospitalId);
  } catch (error) {
    profileError = true;
    console.error('[hospital] patient reliability/history read failed', error);
  }

  if (profileError) {
    return (
      <HospitalShell
        actor={gate.actor}
        hospitalName={hospital?.name ?? 'Your hospital'}
        active="/hospital/patients"
        title="Patient context"
        subtitle={`Appointment relationship · ${formatDateTime(appointment.scheduledFor)}`}
      >
        <ReliabilityErrorCard />
        <div className="mt-4"><VerifiedVisitHistory visits={[]} hospitalView error /></div>
      </HospitalShell>
    );
  }
  if (!profile) notFound();

  return (
    <HospitalShell
      actor={gate.actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/patients"
      title="Patient context"
      subtitle={`Appointment relationship · ${formatDateTime(appointment.scheduledFor)}`}
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs leading-relaxed text-amber-900">
          Limited operational context only. This summary is available because this patient has an
          appointment at your hospital. It contains no clinical notes, diagnoses, reports or documents.
        </p>
      </div>

      <section className="mt-4 rounded-xl border border-ink-200 bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Patient</p>
        <p className="mt-1 font-mono text-sm text-ink-800">{profile.patientId}</p>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ReliabilityCard
          reliability={{ ...profile.reliability, pointHistory: [] }}
          showHistory={false}
        />
        <VerifiedVisitHistory visits={profile.recentVisits} hospitalView />
      </div>
    </HospitalShell>
  );
}
