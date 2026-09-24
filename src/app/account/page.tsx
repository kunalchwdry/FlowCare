import type { Metadata } from 'next';
import { AccountForm } from '@/components/AccountForm';

export const metadata: Metadata = { title: 'Sign in · FlowCare' };
export const dynamic = 'force-dynamic';

export default function AccountPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold text-ink-900">Your FlowCare account</h1>
      <p className="mt-2 text-sm text-ink-600">
        An account lets you save hospitals, track visits, invite a care partner, and use your own
        AI provider key.
      </p>
      <AccountForm />
    </main>
  );
}
