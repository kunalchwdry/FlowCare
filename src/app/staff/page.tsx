import Link from 'next/link';
import type { Metadata } from 'next';
import { getRepo } from '@/lib/data';
import { requireStaffPage, isHospitalAdmin } from '@/lib/auth/guards';
import { listRequests, STAFF_ROLE_LABELS, type StaffRole } from '@/lib/staff/accessRequests';
import { EmptyState } from '@/components/States';
import { FlowCareLogo } from '@/components/Brand';
import type { Appointment } from '@/lib/types';

export const metadata: Metadata = { title: 'Staff dashboard — FlowCare' };
export const dynamic = 'force-dynamic';

const WAITING: Appointment['status'][] = ['booked', 'checked_in'];

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

/* ------------------------------------------------------ pending approval */

function PendingApproval({ hospitalName, requestedRole }: { hospitalName: string; requestedRole: string }) {
  return (
    <div className="mx-auto w-full max-w-lg py-10">
      <div className="fc-card p-7 text-center">
        <FlowCareLogo size="md" href="/" className="justify-center" />
        <span
          className="mx-auto mt-7 grid h-16 w-16 place-items-center rounded-2xl bg-warn-50 text-warn-600 ring-1 ring-warn-200"
          aria-hidden="true"
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </span>
        <h1 className="mt-5 text-xl font-extrabold tracking-tight text-ink-900">
          Your access is still pending
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
          An administrator at <strong className="text-ink-900">{hospitalName}</strong> has to approve
          your request for <strong className="text-ink-900">
            {STAFF_ROLE_LABELS[requestedRole as StaffRole] ?? requestedRole}
          </strong> before the staff area opens.
        </p>
        <p className="mt-4 rounded-xl bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-600">
          This is not a delay we can shortcut for you. Staff accounts can see patient appointments,
          so the permission has to come from the hospital.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/hospitals" className="fc-btn-secondary w-full">Browse hospitals</Link>
          <Link href="/patient" className="fc-btn-ghost w-full">Go to your patient dashboard</Link>
        </div>
      </div>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="mx-auto w-full max-w-lg py-10">
      <div className="fc-card p-7 text-center">
        <FlowCareLogo size="md" href="/" className="justify-center" />
        <h1 className="mt-7 text-xl font-extrabold tracking-tight text-ink-900">
          This account is not staff
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
          You are signed in, but this account has no staff role at any hospital. If you work at
          one, request access and your administrator will review it.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/staff/register" className="fc-btn-primary w-full">Request staff access</Link>
          <Link href="/patient" className="fc-btn-ghost w-full">Go to your patient dashboard</Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- dashboard */

export default async function StaffDashboard() {
  const gate = await requireStaffPage();
  if (gate.state === 'pending') {
    return <PendingApproval hospitalName={gate.hospitalName} requestedRole={gate.requestedRole} />;
  }
  if (gate.state === 'none') return <NoAccess />;

  const user = gate.user;
  const admin = isHospitalAdmin(user);
  const repo = await getRepo();

  const hospital = user.hospitalId ? await repo.getHospital(user.hospitalId) : null;
  const [appointments, pending] = await Promise.all([
    user.hospitalId ? repo.listAppointments({ hospitalId: user.hospitalId }) : Promise.resolve([]),
    admin && user.hospitalId
      ? listRequests({ hospitalId: user.hospitalId, status: 'pending' })
      : Promise.resolve([]),
  ]);

  const today = appointments.filter((a) => isToday(a.scheduledFor));
  const waiting = today.filter((a) => WAITING.includes(a.status));
  const inProgress = today.filter((a) => a.status === 'in_progress');
  const completed = today.filter((a) => a.status === 'completed');
  const requested = appointments.filter((a) => a.status === 'requested');

  const stats = [
    { label: 'Waiting', value: waiting.length, tone: 'text-warn-700', hint: 'checked in or confirmed' },
    { label: 'In consultation', value: inProgress.length, tone: 'text-success-700', hint: 'right now' },
    { label: 'Completed today', value: completed.length, tone: 'text-ink-900', hint: 'seen and closed' },
    { label: 'Awaiting your reply', value: requested.length, tone: 'text-brand-700', hint: 'patient requests' },
  ];

  return (
    <div className="space-y-5 py-2">
      <section className="fc-card animate-fade-up p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="fc-eyebrow">Staff dashboard</p>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-900">
              {hospital?.name ?? 'Your hospital'}
            </h1>
            <p className="mt-2 text-sm text-ink-600">
              Signed in as {user.name} ·{' '}
              <span className={admin ? 'font-semibold text-ink-900' : 'text-ink-600'}>
                {admin ? 'Hospital Administrator' : 'Staff'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/staff/queue" className="fc-btn-primary text-sm">Manage queue</Link>
            <Link href="/staff/appointments" className="fc-btn-secondary text-sm">Appointments</Link>
            {admin && <Link href="/staff/team" className="fc-btn-secondary text-sm">Staff &amp; access</Link>}
          </div>
        </div>
      </section>

      {!user.hospitalId && (
        <section className="rounded-2xl border border-warn-200 bg-warn-50 p-5">
          <h2 className="text-base font-bold text-warn-900">
            This account is not linked to a hospital
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-warn-900/85">
            Your role is recognised, but no hospital is attached to it, so there is nothing to show.
            The counts below are zero for that reason — not because the day is quiet. An operator
            needs to set the hospital on your account before this dashboard becomes useful.
          </p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="fc-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{s.label}</p>
            <p className={`mt-2 text-3xl font-extrabold ${s.tone}`}>{s.value}</p>
            <p className="mt-0.5 text-[11px] text-ink-500">{s.hint}</p>
          </div>
        ))}
      </section>

      {admin && pending.length > 0 && (
        <section className="rounded-2xl border border-warn-200 bg-warn-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-warn-900">
                {pending.length} access {pending.length === 1 ? 'request needs' : 'requests need'} your decision
              </h2>
              <p className="mt-1 text-sm text-warn-900/80">
                Colleagues cannot see any patient data until you approve them.
              </p>
            </div>
            <Link href="/staff/team" className="fc-btn bg-warn-600 text-white hover:bg-warn-700 text-sm">
              Review requests
            </Link>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="fc-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="fc-h2">Today&rsquo;s queue</h2>
            <Link href="/staff/queue" className="text-xs font-semibold text-brand-700 hover:underline">
              Open full view
            </Link>
          </div>
          {waiting.length + inProgress.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {[...inProgress, ...waiting].slice(0, 8).map((a, i) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-ink-200 p-3"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-900">
                      {timeOf(a.scheduledFor)} · {a.reason?.slice(0, 40) || 'Outpatient consultation'}
                    </span>
                    <span className="block truncate text-xs text-ink-500">Ref {a.id.slice(0, 18)}…</span>
                  </span>
                  <span className={a.status === 'in_progress' ? 'fc-pill-success' : 'fc-pill-warn'}>
                    {a.status === 'in_progress' ? 'In consultation' : a.status === 'checked_in' ? 'Checked in' : 'Confirmed'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              title="Nobody in the queue"
              description="Patients appear here once they are confirmed for today or checked in at the desk."
              primary={{ label: 'Open queue management', href: '/staff/queue' }}
            />
          )}
        </section>

        <section className="space-y-4">
          <div className="fc-card p-5">
            <h2 className="fc-h2">Requests to review</h2>
            {requested.length > 0 ? (
              <>
                <p className="mt-2 text-sm text-ink-600">
                  {requested.length} patient {requested.length === 1 ? 'request is' : 'requests are'} waiting
                  for the hospital to confirm.
                </p>
                <Link href="/staff/appointments" className="fc-btn-primary mt-4 w-full text-sm">
                  Review requests
                </Link>
              </>
            ) : (
              <p className="mt-3 rounded-xl bg-ink-50 p-4 text-sm leading-relaxed text-ink-600">
                No unanswered requests. New ones land here as patients submit them.
              </p>
            )}
          </div>

          <div className="fc-card p-5">
            <h2 className="fc-h2">Your permissions</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {[
                ['View today\u2019s queue', true],
                ['Check patients in', true],
                ['Confirm and cancel appointments', true],
                ['Approve staff access', admin],
                ['Change hospital settings', admin],
              ].map(([label, allowed]) => (
                <li key={label as string} className="flex items-center gap-2.5">
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                      allowed ? 'bg-success-100 text-success-700' : 'bg-ink-100 text-ink-400'
                    }`}
                    aria-hidden="true"
                  >
                    {allowed ? '✓' : '—'}
                  </span>
                  <span className={allowed ? 'text-ink-800' : 'text-ink-400'}>{label as string}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] leading-relaxed text-ink-500">
              These are enforced by the database on every request, not by hiding buttons.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
