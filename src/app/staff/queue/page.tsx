import Link from 'next/link';
import type { Metadata } from 'next';
import { requireStaffPage } from '@/lib/auth/guards';
import { getRepo } from '@/lib/data';
import { EmptyState, ErrorState } from '@/components/States';
import type { Appointment } from '@/lib/types';

export const metadata: Metadata = { title: 'Queue management — FlowCare' };
export const dynamic = 'force-dynamic';

const COLUMNS: Array<{ key: Appointment['status']; title: string; tone: string; blurb: string }> = [
  { key: 'checked_in', title: 'Waiting', tone: 'border-warn-200 bg-warn-50', blurb: 'Arrived and checked in at the desk' },
  { key: 'in_progress', title: 'In consultation', tone: 'border-success-100 bg-success-50', blurb: 'Currently with a clinician' },
  { key: 'completed', title: 'Completed', tone: 'border-ink-200 bg-ink-50', blurb: 'Seen and closed today' },
];

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function isToday(iso: string): boolean {
  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && fmt(d) === fmt(new Date());
}

export default async function StaffQueuePage() {
  const gate = await requireStaffPage('/staff/queue');
  if (gate.state !== 'ok') {
    return (
      <div className="py-8">
        <ErrorState kind="forbidden" primary={{ label: 'Back to the staff dashboard', href: '/staff' }} />
      </div>
    );
  }

  const repo = await getRepo();
  const appointments = gate.user.hospitalId
    ? (await repo.listAppointments({ hospitalId: gate.user.hospitalId })).filter((a) => isToday(a.scheduledFor))
    : [];

  return (
    <div className="space-y-5 py-2">
      <header className="fc-card p-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
          <Link href="/staff" className="hover:underline">Staff dashboard</Link>
          <span aria-hidden="true"> / </span>
          <span className="font-semibold text-ink-700">Queue</span>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900">Queue management</h1>
        <p className="mt-2 text-sm text-ink-600">
          Today&rsquo;s outpatient flow. Moving a patient between columns is recorded against your
          account, so the queue always has an accountable history.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = appointments.filter((a) => a.status === col.key);
          return (
            <section key={col.key} className={`rounded-2xl border p-4 ${col.tone}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold text-ink-900">{col.title}</h2>
                <span className="text-lg font-extrabold text-ink-900">{items.length}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-600">{col.blurb}</p>

              {items.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {items.map((a, i) => (
                    <li key={a.id} className="rounded-xl border border-white bg-white p-3 shadow-card">
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-100 text-[11px] font-bold text-ink-700">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink-900">
                            {timeOf(a.scheduledFor)}
                          </span>
                          <span className="block truncate text-[11px] text-ink-500">
                            Ref {a.id.slice(0, 16)}…
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-ink-300 bg-white/60 px-3 py-6 text-center text-xs text-ink-500">
                  Nobody here yet
                </p>
              )}
            </section>
          );
        })}
      </div>

      {appointments.length === 0 && (
        <div className="fc-card">
          <EmptyState
            title="No appointments today"
            description="Once patients are confirmed for today or check in at the desk, the queue fills in here automatically."
            primary={{ label: 'Review appointment requests', href: '/staff/appointments' }}
          />
        </div>
      )}
    </div>
  );
}
