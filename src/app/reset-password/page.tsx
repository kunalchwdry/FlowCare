'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlowCareLogo } from '@/components/Brand';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 10) { setError('Use at least 10 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) { setError(json?.error?.message ?? 'This recovery link is invalid or expired.'); return; }
      setDone(true);
    } catch {
      setError('We could not reach FlowCare. Please try the recovery link again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto w-full max-w-md py-10">
        <div className="fc-card p-7 text-center">
          <FlowCareLogo size="md" href="/" className="justify-center" />
          <h1 className="mt-6 text-xl font-extrabold text-ink-900">Password updated</h1>
          <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
            Your password has been changed. Use it with your approved account to sign in.
          </p>
          <button
            type="button"
            onClick={() => {
              const host = window.location.hostname;
              const staffHost = host.startsWith('hospital-') || host.startsWith('hospital.') || host.startsWith('staff.');
              router.push(staffHost ? '/staff/login' : '/patient/login');
            }}
            className="fc-btn-primary mt-6 w-full"
          >
            Continue to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md py-10">
      <div className="fc-card p-7">
        <FlowCareLogo size="md" href="/" />
        <h1 className="mt-6 text-xl font-extrabold tracking-tight text-ink-900">Choose a new password</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
          Use at least 10 characters. This link can only be used to update the account that requested it.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink-800">New password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="fc-input" autoComplete="new-password" minLength={10} required />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink-800">Confirm new password</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="fc-input" autoComplete="new-password" minLength={10} required />
          </label>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{error}</p>}
          <button type="submit" disabled={busy} className="fc-btn-primary w-full disabled:opacity-60">
            {busy ? 'Updating password…' : 'Update password'}
          </button>
        </form>
      </div>
    </main>
  );
}
