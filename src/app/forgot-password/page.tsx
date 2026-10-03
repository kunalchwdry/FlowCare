import type { Metadata } from 'next';
import Link from 'next/link';
import { FlowCareLogo } from '@/components/Brand';

export const metadata: Metadata = { title: 'Reset your password — FlowCare' };

/**
 * Password reset is delegated to Supabase Auth's recovery email. This page
 * states that plainly rather than pretending to send something itself.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; error_code?: string }>;
}) {
  const params = await searchParams;
  const expired = params.error === 'expired_link'
    || params.error === 'access_denied'
    || params.error_code === 'otp_expired';

  return (
    <div className="mx-auto w-full max-w-md py-10">
      <div className="fc-card p-7">
        <FlowCareLogo size="md" href="/" />
        <h1 className="mt-6 text-xl font-extrabold tracking-tight text-ink-900">
          Reset your password
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
          Enter the email you signed up with. If an account exists, a recovery link is sent to it.
          For your safety we show the same message either way, so nobody can use this page to
          discover which addresses are registered.
        </p>
        {expired && (
          <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
            That recovery link has expired or was already used. Enter your email below to request a fresh link.
          </p>
        )}
        <form
          className="mt-6 space-y-4"
          action="/api/auth/recover"
          method="post"
        >
          <div>
            <label htmlFor="recover-email" className="mb-1.5 block text-sm font-semibold text-ink-800">
              Email address
            </label>
            <input
              id="recover-email" name="email" type="email" required autoComplete="email"
              placeholder="you@example.com" className="fc-input"
            />
          </div>
          <button type="submit" className="fc-btn-primary w-full">Send recovery link</button>
        </form>
        <p className="mt-5 border-t border-ink-100 pt-4 text-sm text-ink-600">
          Remembered it?{' '}
          <Link href="/patient/login" className="font-semibold text-brand-700 underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
