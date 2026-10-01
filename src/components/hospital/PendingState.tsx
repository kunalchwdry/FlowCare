import Link from 'next/link';
import { FlowCareMark } from '@/components/Brand';
import type { SessionUser } from '@/lib/auth/session';

/**
 * Signed in, but no active membership.
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
