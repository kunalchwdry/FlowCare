import Link from 'next/link';
import type { Metadata } from 'next';
import { FlowCareLogo } from '@/components/Brand';

export const metadata: Metadata = {
  title: 'Get started — FlowCare',
  description: 'Create a FlowCare patient account to find hospitals, book appointments and track your care journey.',
};

/**
 * Patient onboarding entry point.
 *
 * Hospital staff use the separate hospital portal. The patient-facing portal
 * intentionally keeps staff authentication out of this flow.
 */
export default function GetStartedPage() {
  return (
    <div className="mx-auto w-full max-w-xl py-8">
      <div className="text-center">
        <FlowCareLogo size="lg" href="/" className="justify-center" />
        <h1 className="mt-7 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Get started with FlowCare
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-600">
          Create a patient account when you are ready to save a hospital, request an appointment
          or follow your place in the queue. You can browse hospitals without an account at any time.
        </p>
      </div>

      <div className="mt-10 group fc-card fc-card-hover animate-fade-up overflow-hidden">
        <div className="h-1.5 bg-brand-500" aria-hidden="true" />
        <div className="flex flex-col p-6 sm:p-8">
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
          <h2 className="mt-4 text-xl font-extrabold text-ink-900">Patient account</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            Find hospitals, compare options, request appointments and track your healthcare journey.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-ink-600">
            {['Search and compare hospitals', 'Request appointment slots', 'Track your place in the queue', 'Review visits you attended'].map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
          <Link href="/patient/signup" className="fc-btn-primary mt-7 w-full">
            Create a patient account
          </Link>
          <p className="mt-3 text-center text-xs text-ink-500">
            Already registered?{' '}
            <Link href="/patient/login" className="font-semibold text-brand-700 underline-offset-4 hover:underline">
              Patient sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
