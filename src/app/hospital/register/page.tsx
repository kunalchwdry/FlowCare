import Link from 'next/link';
import { FlowCareMark } from '@/components/Brand';
import { ClaimForm } from '@/components/hospital/ClaimForm';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Register your hospital — FlowCare',
  description: 'Claim your hospital on FlowCare and manage appointment requests.',
};

export default function RegisterHospital() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="text-center">
        <FlowCareMark size={40} className="mx-auto text-brand-600" />
        <h1 className="mt-4 text-3xl font-bold text-ink-900">Register your hospital</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-ink-600">
          Take over your hospital’s FlowCare listing, publish real appointment availability, and
          accept or decline requests from the hospital portal.
        </p>
      </div>

      {/* Stated before the form, not after it. Somebody expecting instant
          access will otherwise read the pending screen as a failure. */}
      <ol className="mt-8 space-y-2 rounded-2xl border border-ink-200 bg-white p-5 text-sm">
        {[
          ['Listed', 'Your hospital is already findable on FlowCare — most are, imported from OpenStreetMap.'],
          ['You claim it', 'You tell us who you are and how we can check it.'],
          ['We verify', 'A person confirms the connection. This step is not automated.'],
          ['Access granted', 'Your first administrator account is created, and they invite the rest of your staff.'],
          ['Booking enabled', 'Once you publish availability, patients can request appointments.'],
        ].map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {i + 1}
            </span>
            <span>
              <span className="font-semibold text-ink-900">{title}.</span>{' '}
              <span className="text-ink-600">{body}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <ClaimForm />
      </div>

      <p className="mt-8 text-center text-sm text-ink-500">
        Already approved at your hospital?{' '}
        <Link href="/hospital/login" className="font-semibold text-brand-700 underline underline-offset-2">
          Sign in to the portal
        </Link>
      </p>
    </main>
  );
}
