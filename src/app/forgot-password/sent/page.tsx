import Link from 'next/link';
import type { Metadata } from 'next';
import { FlowCareLogo } from '@/components/Brand';

export const metadata: Metadata = { title: 'Check your email — FlowCare' };

export default function RecoverySentPage() {
  return (
    <div className="mx-auto w-full max-w-md py-10">
      <div className="fc-card animate-scale-in p-7 text-center">
        <FlowCareLogo size="md" href="/" className="justify-center" />
        <span
          className="mx-auto mt-7 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100"
          aria-hidden="true"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" />
          </svg>
        </span>
        <h1 className="mt-5 text-xl font-extrabold tracking-tight text-ink-900">Check your email</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
          If an account exists for that address, a recovery link is on its way. It expires after a
          short while, so use it soon.
        </p>
        <Link href="/patient/login" className="fc-btn-secondary mt-6 w-full">Back to sign in</Link>
      </div>
    </div>
  );
}
