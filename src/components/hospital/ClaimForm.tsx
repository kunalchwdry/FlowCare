'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface HospitalOption { id: string; name: string; city: string }

/**
 * Hospital onboarding has two safe paths: claim a listed hospital or request
 * a new listing. Both paths create a pending registration only; a reviewer
 * must verify the organisation before any hospital membership is created.
 */
export function ClaimForm() {
  const [mode, setMode] = useState<'listed' | 'new'>('listed');
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [query, setQuery] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [form, setForm] = useState({
    contactName: '', contactEmail: '', contactPhone: '',
    password: '', confirmPassword: '', statedRole: 'Hospital administrator',
    address: '', website: '', evidenceNote: '', licenseNumber: '', licenseAuthority: '', licenseExpiresOn: '',
    proposedName: '', proposedCity: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    message: string;
    durable: boolean;
    accountMessage: string;
    hospitalName: string | null;
  } | null>(null);

  useEffect(() => {
    let off = false;
    fetch('/api/hospitals/directory')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!off && j?.data?.hospitals) setHospitals(j.data.hospitals); })
      .catch(() => { /* the picker degrades to the "not listed" route */ });
    return () => { off = true; };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hospitals.slice(0, 8);
    return hospitals.filter((h) => `${h.name} ${h.city}`.toLowerCase().includes(q)).slice(0, 8);
  }, [hospitals, query]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);

    if (mode === 'listed' && !hospitalId) { setError('Choose your hospital from the list.'); return; }
    if (mode === 'new' && !form.proposedName.trim()) { setError('Enter the hospital’s name.'); return; }
    if (form.contactName.trim().length < 2) { setError('Enter your full name.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail)) { setError('Enter a valid work email.'); return; }
    if (form.password.length < 10) { setError('Use at least 10 characters for your password.'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    if (form.website && !/^https?:\/\//i.test(form.website.trim())) {
      setError('Website must start with https:// or http://.');
      return;
    }

    setBusy(true);
    try {
      /*
       * Create the administrator's normal FlowCare account first. The server
       * deliberately ignores the requested role: until review, this is only
       * an account, never a hospital membership.
       */
      const signup = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.contactEmail,
          password: form.password,
          fullName: form.contactName,
          phone: form.contactPhone || null,
          role: 'patient',
        }),
      });
      const signupJson = await signup.json().catch(() => null);
      const signupMessage = signupJson?.data?.message ?? '';
      const signupLooksDuplicate = /already|check your email|continue/i.test(signupJson?.error?.message ?? '');
      if (!signup.ok && signup.status !== 503 && !signupLooksDuplicate) {
        setError(signupJson?.error?.message ?? 'We could not create your FlowCare account.');
        return;
      }

      const res = await fetch('/api/hospital/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(mode === 'listed'
            ? { hospitalId }
            : { proposedName: form.proposedName, proposedCity: form.proposedCity || null }),
          address: form.address || null,
          website: form.website || null,
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone || null,
          statedRole: form.statedRole,
          evidenceNote: form.evidenceNote || null,
          licenseNumber: form.licenseNumber || null,
          licenseAuthority: form.licenseAuthority || null,
          licenseExpiresOn: form.licenseExpiresOn || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error?.message ?? 'That did not work. Please try again.'); return; }

      setDone({
        message: json.data.message,
        durable: json.data.durable,
        hospitalName: json.data.claim.hospitalName,
        accountMessage: signupMessage || 'Your account details are ready. Sign in after the registration is approved.',
      });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700" aria-hidden="true">✓</span>
          <div>
            <h2 className="text-lg font-bold text-ink-900">Registration submitted</h2>
            {done.hospitalName && <p className="mt-1 text-sm font-semibold text-brand-800">{done.hospitalName}</p>}
          </div>
        </div>
        <p className="mt-4 text-sm text-ink-600">{done.message}</p>
        <div className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">What happens next</p>
            <p className="mt-1 text-sm text-amber-900">
              A FlowCare reviewer verifies your hospital and administrator details. Until approval,
              no one can view hospital appointments or manage the listing.
            </p>
          </div>
          <div className="border-t border-amber-200 pt-3">
            <p className="text-sm font-semibold text-amber-900">Account status</p>
            <p className="mt-1 text-sm text-amber-900">{done.accountMessage}</p>
          </div>
        </div>
        {!done.durable && (
          <p className="mt-3 text-xs text-ink-500">
            This local preview is using temporary storage. The production deployment uses the
            Supabase registration queue after migration 0009 is applied.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/hospital/login" className="fc-btn-primary !py-2 text-sm">Go to hospital sign in</Link>
          <Link href="/hospitals" className="fc-btn-secondary !py-2 text-sm">Back to FlowCare</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <p className="text-sm font-semibold text-ink-800">Which hospital are you registering?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['listed', 'new'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setHospitalId(''); setError(null); }}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                mode === m ? 'bg-brand-600 text-white' : 'border border-ink-300 text-ink-700'
              }`}
            >
              {m === 'listed' ? 'It is already on FlowCare' : 'It is not listed yet'}
            </button>
          ))}
        </div>

        {mode === 'listed' ? (
          <div className="mt-4">
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Search for your hospital</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Start typing the name"
                className="fc-input mt-1"
                autoComplete="off"
              />
            </label>
            <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-ink-200">
              {matches.length === 0 && (
                <li className="px-3 py-3 text-sm text-ink-500">
                  No match. If it is genuinely not listed, use “It is not listed yet”.
                </li>
              )}
              {matches.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setHospitalId(h.id)}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      hospitalId === h.id ? 'bg-brand-50 font-semibold text-brand-800' : 'hover:bg-ink-50'
                    }`}
                  >
                    {h.name}
                    {h.city && <span className="text-ink-500"> · {h.city}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-ink-700">Hospital name</span>
              <input value={form.proposedName} onChange={set('proposedName')} required maxLength={140} className="fc-input mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">City</span>
              <input value={form.proposedCity} onChange={set('proposedCity')} maxLength={80} className="fc-input mt-1" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Hospital website</span>
              <input type="url" value={form.website} onChange={set('website')} placeholder="https://hospital.org" maxLength={240} className="fc-input mt-1" />
            </label>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <p className="text-sm font-semibold text-ink-800">Hospital details</p>
        <div className="mt-3 grid gap-3">
          {mode === 'listed' && (
            <>
              <label className="block">
                <span className="text-sm font-medium text-ink-700">Hospital website</span>
                <input type="url" value={form.website} onChange={set('website')} placeholder="https://hospital.org" maxLength={240} className="fc-input mt-1" />
              </label>
            </>
          )}
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Address</span>
            <textarea value={form.address} onChange={set('address')} rows={2} maxLength={240} className="fc-input mt-1" placeholder="Full hospital address" />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <p className="text-sm font-semibold text-ink-800">Create the first administrator account</p>
        <p className="mt-1 text-xs text-ink-500">This creates a sign-in only. Administrator access is added after manual verification.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Your full name</span>
            <input value={form.contactName} onChange={set('contactName')} required minLength={2} maxLength={120} className="fc-input mt-1" autoComplete="name" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Your role</span>
            <input value={form.statedRole} onChange={set('statedRole')} required minLength={2} maxLength={80} className="fc-input mt-1" placeholder="e.g. Hospital administrator" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Work email</span>
            <input type="email" value={form.contactEmail} onChange={set('contactEmail')} required maxLength={200} className="fc-input mt-1" autoComplete="email" placeholder="you@hospital.org" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Phone</span>
            <input type="tel" value={form.contactPhone} onChange={set('contactPhone')} maxLength={30} className="fc-input mt-1" autoComplete="tel" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Password</span>
            <input type="password" value={form.password} onChange={set('password')} required minLength={10} className="fc-input mt-1" autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Confirm password</span>
            <input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} required minLength={10} className="fc-input mt-1" autoComplete="new-password" />
          </label>
        </div>
        <div className="mt-4 border-t border-ink-100 pt-4">
          <p className="text-sm font-semibold text-ink-800">Registration details for review</p>
          <p className="mt-1 text-xs text-ink-500">These details help a FlowCare reviewer match your request to an official hospital record.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-ink-700">License/registration no.</span>
              <input value={form.licenseNumber} onChange={set('licenseNumber')} maxLength={120} className="fc-input mt-1" placeholder="Optional" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Issuing authority</span>
              <input value={form.licenseAuthority} onChange={set('licenseAuthority')} maxLength={160} className="fc-input mt-1" placeholder="e.g. state health dept." />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Expiry date</span>
              <input type="date" value={form.licenseExpiresOn} onChange={set('licenseExpiresOn')} className="fc-input mt-1" />
            </label>
          </div>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-ink-700">How can we verify your connection?</span>
          <textarea
            value={form.evidenceNote}
            onChange={set('evidenceNote')}
            rows={3}
            maxLength={400}
            placeholder="A hospital website listing you, a switchboard number we can call, or a letterhead address"
            className="fc-input mt-1"
          />
          <span className="mt-1 block text-xs text-ink-500">A work email alone is not enough to hand over a hospital’s appointments.</span>
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="fc-btn-primary w-full disabled:opacity-60">
        {busy ? 'Creating your registration…' : 'Register hospital for review'}
      </button>
      <p className="text-center text-xs text-ink-500">
        Registration is reviewed manually. No hospital or administrator access is granted automatically.
      </p>
    </form>
  );
}
