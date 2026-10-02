import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/auth/session';
import { label } from '@/lib/discovery/filters';
import { IconCalendar } from '@/components/Icons';
import { formatDateTime } from '@/lib/time';

export const metadata: Metadata = {
  title: 'Appointment request · FlowCare',
  description: 'What you asked the hospital for, and what happens next.',
};

export const dynamic = 'force-dynamic';

const STATUS_COPY: Record<string, { pill: string; tone: string; detail: string }> = {
  requested: {
    pill: 'Requested',
    tone: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
    detail:
      'The hospital has not confirmed this yet. Wait for confirmation before you travel. If you do not hear back, call the hospital using the number on its FlowCare page.',
  },
  booked: {
    pill: 'Confirmed by the hospital',
    tone: 'bg-brand-50 text-brand-900 ring-1 ring-brand-200',
    detail: 'The hospital has accepted this slot. Bring the documents listed on your visit card.',
  },
  cancelled: {
    pill: 'Cancelled',
    tone: 'bg-ink-100 text-ink-700 ring-1 ring-ink-200',
    detail: 'This slot is no longer held for you.',
  },
};

export default async function AppointmentReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSession();
  if (!user) redirect('/account');

  const repo = await getRepo();
  const appointment = await repo.getAppointment(id);

  // An appointment belongs to one patient. An unauthorised read is a
  // not-found, never a "forbidden" that would confirm the id exists.
  if (!appointment || appointment.patientId !== user.id) notFound();

  const hospital = await repo.getHospital(appointment.hospitalId);
  const copy = STATUS_COPY[appointment.status] ?? {
    pill: appointment.status,
    tone: 'bg-ink-100 text-ink-700 ring-1 ring-ink-200',
    detail: 'Current status recorded by FlowCare.',
  };
  const when = new Date(appointment.scheduledFor);

  return (
    <div className="space-y-4 py-2">
      <nav className="text-xs text-ink-500">
        <Link href="/appointments" className="hover:underline">My visits</Link> /{' '}
        <span className="font-medium text-ink-700">Request</span>
      </nav>

      <header className="fc-card p-5">
        <span className={`fc-pill ${copy.tone}`}>{copy.pill}</span>
        <h1 className="mt-2 text-lg font-extrabold">{hospital?.name ?? appointment.hospitalId}</h1>
        <p className="mt-0.5 text-sm text-ink-600">{hospital?.addressLine}</p>
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold">
          <IconCalendar width={15} height={15} className="text-brand-600" />
          {formatDateTime(when)}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {label(appointment.departmentId.split(':dept:')[1] ?? '')} · reference{' '}
          <span className="font-mono">{appointment.id}</span>
        </p>
      </header>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">What happens next</h2>
        <p className="mt-1.5 text-xs text-ink-600">{copy.detail}</p>
        {appointment.reason && (
          <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-[11px] text-ink-700">
            <span className="font-semibold">You wrote:</span> {appointment.reason}
          </p>
        )}
        <p className="mt-2 text-[11px] text-ink-500">
          FlowCare records the request and shows you its status. It does not decide whether the hospital accepts it,
          and it gives no medical advice about whether this is the right appointment for you.
        </p>
      </section>

      <section className="fc-card p-5">
        <h2 className="text-sm font-bold">Before you go</h2>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {hospital && (
            <>
              <Link href={`/visit/${hospital.id}`} className="fc-btn-ghost text-xs">Visit card</Link>
              <Link href={`/hospitals/${hospital.slug}`} className="fc-btn-ghost text-xs">Hospital page</Link>
            </>
          )}
          <Link href="/appointments" className="fc-btn-primary text-xs">All my visits</Link>
        </div>
      </section>
    </div>
  );
}
