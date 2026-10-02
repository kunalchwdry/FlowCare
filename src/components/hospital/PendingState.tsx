import Link from 'next/link';
import { FlowCareMark } from '@/components/Brand';
import { HospitalShell } from '@/components/hospital/HospitalShell';
import type { HospitalActor, HospitalPermission } from '@/lib/auth/hospital';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Signed in, but no active membership anywhere.
 *
 * Deliberately not a redirect to the login page. This person has an account
 * and has already signed in; bouncing them back to a form they just
 * completed tells them nothing and reads as a bug. They are either waiting
 * for approval or signed in with a patient account by mistake, and both
 * need saying out loud.
 */
export function PendingState({ user }: { user: SessionUser }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
      <FlowCareMark size={44} className="text-brand-600" />
      <h1 className="mt-5 text-2xl font-bold text-ink-900">No hospital access yet</h1>
      <p className="mt-3 text-sm text-ink-600">
        You are signed in as <span className="font-semibold">{user.email || user.name}</span>, but
        this account is not an approved member of staff at any hospital.
      </p>
      <div className="mt-5 w-full rounded-xl border border-ink-200 bg-white p-4 text-left">
        <p className="text-sm font-semibold text-ink-800">What happens next</p>
        <p className="mt-2 text-sm text-ink-600">
          An administrator at your hospital has to approve your access. Approval is never
          automatic — it is the step that stops anyone who can create an account from reading
          patient appointments.
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <Link href="/staff/register" className="fc-btn-primary !py-2 text-sm">
          Request staff access
        </Link>
        <Link href="/hospitals" className="fc-btn-secondary !py-2 text-sm">
          Go to the patient app
        </Link>
      </div>
    </main>
  );
}

/**
 * Signed in, correct hospital, but missing the permission this page needs.
 *
 * Shown inside the portal rather than as a redirect: the person belongs
 * here, they simply cannot open this one screen. Naming the missing
 * permission lets them ask their administrator for the right thing rather
 * than reporting "it does not work".
 */
export function NoPermission({
  actor,
  needs,
  active,
  title,
  hospitalName = 'Your hospital',
}: {
  actor: HospitalActor;
  needs: HospitalPermission | string;
  active: string;
  title: string;
  hospitalName?: string;
}) {
  return (
    <HospitalShell actor={actor} hospitalName={hospitalName} active={active} title={title}>
      <div className="rounded-xl border border-ink-200 bg-white p-6">
        <p className="text-sm font-semibold text-ink-800">You do not have access to this page</p>
        <p className="mt-1 text-sm text-ink-600">
          It needs the{' '}
          <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs">{needs}</code>{' '}
          permission. A manager at your hospital can grant it from the Staff page.
        </p>
        <p className="mt-3 text-xs text-ink-500">
          This is enforced by the server on every request, not by hiding the link.
        </p>
      </div>
    </HospitalShell>
  );
}
