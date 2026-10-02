import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Hospital sign in — FlowCare',
  description: 'Sign in to the FlowCare hospital portal.',
};

/**
 * The staff front door.
 *
 * LoginForm renders the whole AuthShell — grid, card, logo, heading and the
 * fixed-width side panel. This page previously wrapped it in a max-w-md
 * container, which crushed that entire two-column layout into 448px and
 * drew a second logo and heading above it. The shell owns its own width;
 * anything extra belongs beside it, not around it.
 */
export default async function HospitalLogin({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await getSession();

  // Already signed in with staff standing — no reason to show a form.
  if (user && (user.role === 'staff' || user.role === 'admin') && user.hospitalId) {
    redirect(next && next.startsWith('/hospital') ? next : '/hospital');
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <LoginForm role="staff" next={next ?? '/hospital'} />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-900">Work here but have no access?</p>
          <p className="mt-1 text-sm text-ink-600">
            Request it, and an administrator at your hospital approves you. Access is never
            granted automatically — that approval is what stops anyone who can create an account
            from reading patient appointments.
          </p>
          <Link
            href="/staff/register"
            className="mt-3 inline-flex text-sm font-semibold text-brand-700 underline underline-offset-2"
          >
            Request staff access
          </Link>
        </div>

        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-ink-900">Hospital not on FlowCare yet?</p>
          <p className="mt-1 text-sm text-ink-700">
            If nobody from your hospital manages its listing, claim it. A reviewer verifies the
            claim before any access is granted.
          </p>
          <Link href="/hospital/register" className="mt-3 inline-flex fc-btn-primary !py-2 text-sm">
            Register your hospital
          </Link>
        </div>
      </div>
    </main>
  );
}
