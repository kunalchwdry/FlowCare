'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailConfirmed: boolean;
}

export function AccountForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authAvailable, setAuthAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  async function refresh() {
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' });
      const j = await r.json();
      setUser(j.data?.user ?? null);
      setAuthAvailable(Boolean(j.data?.authAvailable));
    } catch {
      setAuthAvailable(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const url = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const payload =
        mode === 'signup'
          ? { email, password, fullName: fullName || null }
          : { email, password };
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j?.error?.message ?? 'That did not work.');
        return;
      }
      if (mode === 'signup' && j.data?.needsConfirmation) {
        setNotice(j.data.message);
        setMode('signin');
        return;
      }
      setPassword('');
      await refresh();
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await fetch('/api/auth/signout', { method: 'POST' });
    setUser(null);
    setBusy(false);
    router.refresh();
  }

  if (loading) return <p className="mt-6 text-sm text-ink-500">Checking your session…</p>;

  if (!authAvailable) {
    return (
      <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Accounts are not available on this deployment.</strong> Supabase is not configured,
        so FlowCare is running on local demo data. Everything you see is synthetic.
      </div>
    );
  }

  if (user) {
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-sm text-ink-500">Signed in as</p>
          <p className="text-base font-semibold text-ink-900">{user.email}</p>
          {!user.emailConfirmed && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Your email is not confirmed yet. Some actions stay blocked until it is.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/settings" className="fc-btn-secondary text-sm">
            AI provider keys
          </a>
          <a href="/appointments" className="fc-btn-secondary text-sm">
            My visits
          </a>
          <button onClick={signOut} disabled={busy} className="fc-btn-secondary text-sm">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div className="flex rounded-xl border border-ink-200 p-1 text-sm font-semibold">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(null); }}
            className={`flex-1 rounded-lg px-3 py-2 ${
              mode === m ? 'bg-brand-600 text-white' : 'text-ink-600'
            }`}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      {mode === 'signup' && (
        <label className="block">
          <span className="text-sm font-medium text-ink-700">Your name (optional)</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            autoComplete="name"
            maxLength={80}
          />
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          autoComplete="email"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Password</span>
        <input
          type="password"
          required
          minLength={mode === 'signup' ? 10 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />
        {mode === 'signup' && (
          <span className="mt-1 block text-xs text-ink-500">At least 10 characters.</span>
        )}
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      <button type="submit" disabled={busy} className="fc-btn-primary w-full">
        {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}
