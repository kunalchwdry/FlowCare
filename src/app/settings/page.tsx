import type { Metadata } from 'next';
import { IconShield } from '@/components/Icons';

export const metadata: Metadata = { title: 'FlowCare AI settings' };
export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink-900">FlowCare AI</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        FlowCare AI is managed by the application. You do not need to enter an API key or create a
        provider account to use the assistant.
      </p>
      <section className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-700">
            <IconShield width={18} height={18} />
          </span>
          <div>
            <h2 className="text-sm font-bold text-brand-950">Server-managed AI</h2>
            <p className="mt-1 text-sm leading-relaxed text-brand-900">
              Your messages go to FlowCare&apos;s backend. The application uses its centrally managed
              Gemini provider key, which is never sent to your browser or included in responses.
            </p>
            <p className="mt-2 text-xs text-brand-800">
              Conversation context is kept only in your current chat session and is cleared when you
              start a new search.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
