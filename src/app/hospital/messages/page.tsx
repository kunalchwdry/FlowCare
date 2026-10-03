import type { Metadata } from 'next';
import { getRepo } from '@/lib/data';
import { requireHospitalPermission } from '@/lib/auth/hospital';
import { HospitalShell } from '@/components/hospital/HospitalShell';
import { PendingState } from '@/components/hospital/PendingState';
import { MessageInbox, type MessageThread } from '@/components/appointments/MessageInbox';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Messages — FlowCare hospital portal',
  description: 'Keep every patient appointment conversation in one place.',
};

export default async function HospitalMessagesPage() {
  const gate = await requireHospitalPermission('appointments:read', '/hospital/messages');
  if (gate.kind === 'no-membership') return <PendingState user={gate.user} />;
  if (gate.kind === 'forbidden') {
    return (
      <HospitalShell
        actor={gate.actor}
        hospitalName="Your hospital"
        active="/hospital/messages"
        title="Messages"
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
  const repo = await getRepo();
  const [hospital, appointments] = await Promise.all([
    repo.getHospital(actor.hospitalId),
    // The hospital id comes from the authenticated membership, not the URL.
    repo.listAppointments({ hospitalId: actor.hospitalId }),
  ]);

  const threads = (await Promise.all(appointments.map(async (appointment): Promise<MessageThread> => {
    const messages = await repo.listAppointmentMessages(appointment.id).catch(() => []);
    return {
      appointmentId: appointment.id,
      title: appointment.patientName || 'Patient conversation',
      subtitle: appointment.departmentName ?? appointment.departmentId.split(':dept:')[1] ?? 'Appointment',
      scheduledFor: appointment.scheduledFor,
      status: appointment.status,
      version: appointment.version ?? 1,
      messages,
    };
  }))).sort((a, b) => {
    const aLast = a.messages.at(-1)?.createdAt ?? a.scheduledFor;
    const bLast = b.messages.at(-1)?.createdAt ?? b.scheduledFor;
    return bLast.localeCompare(aLast);
  });

  return (
    <HospitalShell
      actor={actor}
      hospitalName={hospital?.name ?? 'Your hospital'}
      active="/hospital/messages"
      title="Messages"
      subtitle="Patient conversations are saved by appointment and scoped to your hospital."
    >
      <MessageInbox audience="hospital" threads={threads} />
    </HospitalShell>
  );
}
