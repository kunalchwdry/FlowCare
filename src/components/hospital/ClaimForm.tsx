'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface HospitalOption { id: string; name: string; city: string }

/**
 * Register a hospital on FlowCare.
 *
 * Two routes in, because both situations are real: the facility is already
 * listed (imported from OpenStreetMap, nobody has claimed it), or it is not
 * listed at all.
 *
 * The form is explicit that submitting grants nothing. That is not legal
 * hedging — it is the actual behaviour, and someone expecting a dashboard on
 * the next screen will otherwise read the pending state as a bug.
 */
export function ClaimForm() {
  const [mode, setMode] = useState<'listed' | 'new'>('listed');
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [query, setQuery] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [form, setForm] = useState({
    contactName: '', contactEmail: '', contactPhone: '',
    statedRole: '', evidenceNote: '', proposedName: '', proposedCity: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; durable: boolean } | null>(null);

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

    setBusy(true);
    try {
      const res = await fetch('/api/hospital/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(mode === 'listed'
            ? { hospitalId }
            : { proposedName: form.proposedName, proposedCity: form.proposedCity || null }),
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone || null,
          statedRole: form.statedRole,
          evidenceNote: form.evidenceNote || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setError(json?.error?.message ?? 'That did not work. Please try again.'); return; }
      setDone({ message: json.data.message, durable: json.data.durable });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-6">
        <h2 className="text-lg font-bold text-ink-900">Claim submitted</h2>
        <p className="mt-2 text-sm text-ink-600">{done.message}</p>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Nothing has been granted yet</p>
          <p className="mt-1 text-sm text-amber-900">
            A reviewer has to confirm you are connected to this hospital before any account can
            manage its information or see its appointments. You will not be able to sign in to the
            portal until then.
          </p>
        </div>
        {!done.durable && (
          <p className="mt-3 text-xs text-ink-500">
            Note: this deployment’s storage is read-only, so the claim is held only for this
            session. Please mention that if you follow up.
          </p>
        )}
        <Link href="/hospitals" className="mt-5 inline-flex fc-btn-secondary !py-2 text-sm">
          Back to FlowCare
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <p className="text-sm font-semibold text-ink-800">Which hospital?</p>
        <div className="mt-3 flex gap-2">
          {(['listed', 'new'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
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
            <label className="block">
              <span className="text-sm font-medium text-ink-700">Hospital name</span>
              <input value={form.proposedName} onChange={set('proposedName')} className="fc-input mt-1" maxLength={140} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-700">City</span>
              <input value={form.proposedCity} onChange={set('proposedCity')} className="fc-input mt-1" maxLength={80} />
            </label>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white p-5">
        <p className="text-sm font-semibold text-ink-800">About you</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Your name</span>
            <input value={form.contactName} onChange={set('contactName')} required minLength={2} maxLength={80} className="fc-input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Your role at the hospital</span>
            <input value={form.statedRole} onChange={set('statedRole')} required minLength={2} maxLength={80}
                   placeholder="e.g. Operations manager" className="fc-input mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Work email</span>
            <input type="email" value={form.contactEmail} onChange={set('contactEmail')} required maxLength={200}
                   className="fc-input mt-1" autoComplete="email" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Phone (optional)</span>
            <input value={form.contactPhone} onChange={set('contactPhone')} maxLength={30} className="fc-input mt-1" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-sm font-medium text-ink-700">How can we verify this?</span>
          <textarea
            value={form.evidenceNote}
            onChange={set('evidenceNote')}
            rows={3}
            maxLength={400}
            placeholder="A hospital website listing you, a switchboard number we can call, or a letterhead address"
            className="fc-input mt-1"
          />
          <span className="mt-1 block text-xs text-ink-500">
            A work email alone is not enough to hand over a hospital’s appointments.
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="fc-btn-primary w-full disabled:opacity-60">
        {busy ? 'Submitting…' : 'Submit claim for review'}
      </button>
      <p className="text-center text-xs text-ink-500">
        Submitting does not grant access. A reviewer verifies every claim first.
      </p>
    </form>
  );
}
