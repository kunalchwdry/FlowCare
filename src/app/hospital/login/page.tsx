import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FlowCareMark } from '@/components/Brand';
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
 * Same credentials and the same Supabase auth as the patient app — this is
 * a different entrance to one building, not a second account system. What
 * differs is only where you land afterwards and the explanation around the
 * form, because somebody arriving here is at work rather than looking for
 * care.
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
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <FlowCareMark size={40} className="mx-auto text-brand-600" />
          <h1 className="mt-4 text-2xl font-bold text-ink-900">Hospital portal</h1>
          <p className="mt-2 text-sm text-ink-600">
            Sign in to manage appointment requests, your queue and your hospital’s published
            information.
          </p>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
          <LoginForm role="staff" next={next ?? '/hospital'} />
        </div>

        <div className="mt-5 rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-800">Don’t have access yet?</p>
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

        <p className="mt-6 text-center text-xs text-ink-500">
          Looking for care rather than working here?{' '}
          <Link href="/patient/login" className="font-semibold text-brand-700 underline underline-offset-2">
            Patient sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
