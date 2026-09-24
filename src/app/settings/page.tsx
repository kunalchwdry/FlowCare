import type { Metadata } from 'next';
import { ApiKeySettings } from '@/components/ApiKeySettings';

export const metadata: Metadata = { title: 'Settings · FlowCare' };
export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink-900">AI provider keys</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        Bring your own API key and the assistant runs on your account with your quota and your
        choice of model. FlowCare encrypts the key before storing it and never shows it again.
      </p>
      <ApiKeySettings />
    </main>
  );
}
