import Link from 'next/link';
import type { Metadata } from 'next';
import { requireStaffPage } from '@/lib/auth/guards';
import { getRepo } from '@/lib/data';
import { EmptyState, ErrorState } from '@/components/States';
import type { Appointment } from '@/lib/types';
import { formatDateTime } from '@/lib/time';

export const metadata: Metadata = { title: 'Appointments — FlowCare' };
export const dynamic = 'force-dynamic';

const GROUPS: Array<{ title: string; statuses: Appointment['status'][]; blurb: string }> = [
  { title: 'Awaiting your decision', statuses: ['requested'], blurb: 'Patients have asked for these. They are not confirmed yet.' },
  { title: 'Confirmed', statuses: ['booked', 'checked_in', 'in_progress'], blurb: 'Accepted by the hospital.' },
  { title: 'Closed', statuses: ['completed', 'cancelled', 'no_show'], blurb: 'Finished, cancelled or missed.' },
];

function when(iso: string): string {
  return formatDateTime(iso);
}

export default async function StaffAppointmentsPage() {
  const gate = await requireStaffPage('/staff/appointments');
  if (gate.state !== 'ok') {
    return (
      <div className="py-8">
        <ErrorState kind="forbidden" primary={{ label: 'Back to the staff dashboard', href: '/staff' }} />
      </div>
    );
  }

  const repo = await getRepo();
  const appointments = gate.user.hospitalId
    ? await repo.listAppointments({ hospitalId: gate.user.hospitalId })
    : [];

  return (
    <div className="space-y-5 py-2">
      <header className="fc-card p-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
          <Link href="/staff" className="hover:underline">Staff dashboard</Link>
          <span aria-hidden="true"> / </span>
          <span className="font-semibold text-ink-700">Appointments</span>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900">Appointment management</h1>
        <p className="mt-2 text-sm text-ink-600">
          Requests are kept separate from confirmations on purpose: a patient who has asked for a
          slot has not been promised one.
        </p>
      </header>

      {appointments.length === 0 ? (
        <div className="fc-card">
          <EmptyState
            title="No appointments yet"
            description="When patients request a session at this hospital, it lands here for you to accept or decline."
            primary={{ label: 'Back to the dashboard', href: '/staff' }}
          />
        </div>
      ) : (
        GROUPS.map((g) => {
          const items = appointments
            .filter((a) => g.statuses.includes(a.status))
            .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
          return (
            <section key={g.title} className="fc-card p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="fc-h2">{g.title}</h2>
                <span className="fc-pill-muted">{items.length}</span>
              </div>
              <p className="mt-1 text-sm text-ink-600">{g.blurb}</p>

              {items.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-ink-300 px-4 py-6 text-center text-xs text-ink-500">
                  Nothing in this group
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink-200 text-[11px] uppercase tracking-wide text-ink-500">
                        <th scope="col" className="pb-2 pr-3 font-bold">When</th>
                        <th scope="col" className="pb-2 pr-3 font-bold">Reference</th>
                        <th scope="col" className="pb-2 pr-3 font-bold">Reason</th>
                        <th scope="col" className="pb-2 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {items.map((a) => (
                        <tr key={a.id}>
                          <td className="py-3 pr-3 font-semibold text-ink-900">{when(a.scheduledFor)}</td>
                          <td className="py-3 pr-3 font-mono text-[11px] text-ink-500">{a.id.slice(0, 18)}…</td>
                          <td className="py-3 pr-3 text-ink-600">{a.reason?.slice(0, 48) || '—'}</td>
                          <td className="py-3">
                            <span className={a.status === 'requested' ? 'fc-pill-warn' : 'fc-pill-muted'}>
                              {a.status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
