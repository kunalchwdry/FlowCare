import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { MessageInbox, type MessageThread } from '@/components/appointments/MessageInbox';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Messages — FlowCare',
  description: 'Keep every hospital appointment conversation in one place.',
};

export default async function MessagesPage() {
  const user = await getSession();
  if (!user) redirect('/account');

  const repo = await getRepo();
  const [appointments, hospitals] = await Promise.all([
    repo.listAppointments({ patientId: user.id }),
    repo.listHospitals(),
  ]);
  const byHospital = new Map(hospitals.map((h) => [h.id, h.name]));

  const threads = (await Promise.all(appointments.map(async (appointment): Promise<MessageThread | null> => {
    const messages = await repo.listAppointmentMessages(appointment.id).catch(() => []);
    const active = !['completed', 'cancelled', 'rejected', 'no_show'].includes(appointment.status);
    if (messages.length === 0 && !active) return null;
    return {
      appointmentId: appointment.id,
      title: byHospital.get(appointment.hospitalId) ?? appointment.hospitalId,
      subtitle: appointment.departmentName ?? appointment.departmentId.split(':dept:')[1] ?? 'Appointment',
      scheduledFor: appointment.scheduledFor,
      status: appointment.status,
      version: appointment.version ?? 1,
      messages,
    };
  }))).filter((thread): thread is MessageThread => Boolean(thread));

  threads.sort((a, b) => {
    const aLast = a.messages.at(-1)?.createdAt ?? a.scheduledFor;
    const bLast = b.messages.at(-1)?.createdAt ?? b.scheduledFor;
    return bLast.localeCompare(aLast);
  });

  return (
    <div className="space-y-4 py-2">
      <header>
        <h1 className="text-xl font-extrabold text-ink-900">Messages</h1>
        <p className="mt-1 text-sm text-ink-600">
          Hospital messages, suggested times and your replies are saved here by appointment.
        </p>
      </header>
      <MessageInbox audience="patient" threads={threads} />
    </div>
  );
}
