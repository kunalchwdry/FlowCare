import Link from 'next/link';
import type { Metadata } from 'next';
import { FlowCareLogo } from '@/components/Brand';

export const metadata: Metadata = {
  title: 'Get started — FlowCare',
  description: 'Choose how you will use FlowCare: as a patient, or as hospital staff.',
};

/**
 * Role gate.
 *
 * The two account types need genuinely different information, different
 * dashboards and different permissions, so they get different front doors
 * rather than one form with conditional fields nobody reads.
 */
export default function GetStartedPage() {
  return (
    <div className="mx-auto w-full max-w-4xl py-8">
      <div className="text-center">
        <FlowCareLogo size="lg" href="/" className="justify-center" />
        <h1 className="mt-7 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          How will you use FlowCare?
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-600">
          Pick the one that fits. You can browse hospitals without an account at any time.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {/* -------------------------------------------------- patient */}
        <div className="group fc-card fc-card-hover animate-fade-up overflow-hidden">
          <div className="h-1.5 bg-brand-500" aria-hidden="true" />
          <div className="flex h-full flex-col p-6">
            <span
              className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100"
              aria-hidden="true"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.6" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
              </svg>
            </span>
            <h2 className="mt-4 text-xl font-extrabold text-ink-900">Patient</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Find hospitals, book appointments, and track your healthcare journey.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-ink-600">
              {['Search and compare hospitals', 'Request appointment slots', 'Track your place in the queue', 'Review visits you attended'].map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex-1" />
            <Link href="/patient/signup" className="fc-btn-primary w-full">
              Continue as Patient
            </Link>
            <p className="mt-3 text-center text-xs text-ink-500">
              Already registered?{' '}
              <Link href="/patient/login" className="font-semibold text-brand-700 underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        {/* ---------------------------------------------------- staff */}
        <div className="group fc-card fc-card-hover animate-fade-up overflow-hidden [animation-delay:60ms]">
          <div className="h-1.5 bg-ink-900" aria-hidden="true" />
          <div className="flex h-full flex-col p-6">
            <span
              className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-ink-800 ring-1 ring-ink-200"
              aria-hidden="true"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18M5 21V7l7-4 7 4v14" />
                <path d="M12 9.5v4M10 11.5h4" />
                <path d="M9.5 21v-4h5v4" />
              </svg>
            </span>
            <h2 className="mt-4 text-xl font-extrabold text-ink-900">Hospital Staff</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Manage patients, appointments, queues, and hospital operations.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-ink-600">
              {['Run the live outpatient queue', 'Check patients in on arrival', 'Manage appointment requests', 'See today\u2019s operational load'].map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-500" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex-1" />
            <Link href="/staff/register" className="fc-btn w-full bg-ink-900 text-white hover:bg-ink-800">
              Continue as Hospital Staff
            </Link>
            <p className="mt-3 text-center text-xs text-ink-500">
              Already have access?{' '}
              <Link href="/staff/login" className="font-semibold text-brand-700 underline-offset-4 hover:underline">
                Staff sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      <p className="mx-auto mt-8 max-w-xl rounded-xl bg-ink-100 px-4 py-3 text-center text-xs leading-relaxed text-ink-600">
        Staff access is not self-service. Registering sends a request to that hospital&rsquo;s
        administrator, who must approve it before any patient or queue data becomes visible.
      </p>
    </div>
  );
}
