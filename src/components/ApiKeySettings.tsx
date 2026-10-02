'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatTime } from '@/lib/time';

interface ProviderInfo {
  id: string;
  label: string;
  note: string;
  defaultModel: string;
  models: string[];
  serverKeyPresent: boolean;
}

interface StoredKey {
  provider: string;
  label: string | null;
  model: string | null;
  masked: string;
  status: 'unvalidated' | 'valid' | 'invalid';
  lastError: string | null;
  lastValidatedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
}

export function ApiKeySettings() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [vaultAvailable, setVaultAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);

  const [provider, setProvider] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [custom, setCustom] = useState(false);

  // The provider owns the model list, so a model chosen for one provider
  // must not survive a switch to another — a Groq id sent to Gemini fails
  // in a way that looks like a bad key.
  const current = providers.find((p) => p.id === provider);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  /**
   * Last check result per provider. Held separately from the stored key
   * status because "rate limited" and "provider down" are facts about this
   * attempt, not about the key — persisting them would mislabel a good key.
   */
  const [checks, setChecks] = useState<Record<string, { status: string; message: string; model: string | null; checkedAt: string }>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/keys', { cache: 'no-store' });
      if (r.status === 401) {
        setAuthed(false);
        return;
      }
      const j = await r.json();
      if (j.ok) {
        setProviders(j.data.providers ?? []);
        setKeys(j.data.keys ?? []);
        setVaultAvailable(Boolean(j.data.vaultAvailable));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, model: model || null }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j?.error?.message ?? 'Could not save that key.');
        return;
      }
      // Clear immediately: the plaintext should not linger in the DOM.
      setApiKey('');
      setNotice(j.data.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function test(p: string) {
    setTesting(p);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch('/api/settings/keys/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: p }),
      });
      const j = await r.json();
      if (j.ok) {
        (j.data.valid ? setNotice : setError)(j.data.message);
      } else {
        setError(j?.error?.message ?? 'Could not test that key.');
      }
      await load();
    } finally {
      setTesting(null);
    }
  }

  async function remove(p: string) {
    setBusy(true);
    try {
      await fetch('/api/settings/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: p }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="mt-6 text-sm text-ink-500">Loading…</p>;

  if (!authed) {
    return (
      <div className="mt-6 rounded-xl border border-ink-200 bg-white p-5 text-sm">
        <p className="font-semibold text-ink-900">Sign in to manage your keys</p>
        <p className="mt-1 text-ink-600">
          A stored key belongs to one account, so FlowCare will not let you save one anonymously.
        </p>
        <a href="/account" className="fc-btn-primary mt-4 inline-flex text-sm">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-ink-200 bg-brand-50/50 p-4 text-sm text-ink-700">
        <p className="font-semibold text-ink-900">How your key is handled</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Encrypted with AES-256-GCM before it is written to the database.</li>
          <li>
            The decryption key lives in the server environment, never in the database — a database
            dump on its own cannot be turned back into your key.
          </li>
          <li>Never sent back to your browser. You will only ever see the last four characters.</li>
          <li>Never written to logs and never included in a prompt.</li>
          <li>No FlowCare operator or hospital staff member can read it.</li>
        </ul>
        {!vaultAvailable && (
          <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-amber-900">
            <strong>Saving is turned off on this server.</strong> The operator has not set
            FLOWCARE_KEY_ENCRYPTION_SECRET, and FlowCare refuses to store a key it cannot encrypt
            properly.
          </p>
        )}
      </section>

      <form onSubmit={save} className="rounded-xl border border-ink-200 bg-white p-5">
        <h2 className="text-base font-semibold text-ink-900">Add or replace a key</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink-700">Provider</span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel('');
                setCustom(false);
              }}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-500">
              {current?.note}
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-ink-700">Model (optional)</span>
            {/*
              * A select, not a text box. This was free text, and a single
              * mistyped id is accepted at save time then fails on every
              * call with the provider's own error — which reads like a bad
              * key rather than a typo. The list comes from the server so it
              * stays in step with the adapters, and "Custom" is kept for
              * models that are not listed, since providers churn constantly.
              */}
            {custom ? (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={current?.defaultModel ?? ''}
                className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 font-mono text-sm"
                maxLength={80}
                name="ai-model-id"
                id="ai-model-id"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="ai-model-hint"
              />
            ) : (
              <select
                value={model}
                onChange={(e) => {
                  if (e.target.value === '__custom__') { setCustom(true); setModel(''); return; }
                  setModel(e.target.value);
                }}
                className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
                aria-describedby="ai-model-hint"
              >
                <option value="">
                  Default — {current?.defaultModel ?? 'provider default'}
                </option>
                {(current?.models ?? [])
                  .filter((m) => m !== current?.defaultModel)
                  .map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                <option value="__custom__">Custom…</option>
              </select>
            )}
            <span id="ai-model-hint" className="mt-1 block text-xs text-ink-500">
              {custom ? (
                <>
                  Type an exact model id for {current?.label ?? 'this provider'}.{' '}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => { setCustom(false); setModel(''); }}
                  >
                    Back to the list
                  </button>
                </>
              ) : (
                <>Leave on default unless you need a specific model.</>
              )}
            </span>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-ink-700">API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            minLength={8}
            maxLength={400}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 font-mono text-sm"
            placeholder="Paste the key itself, without the word Bearer"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {notice}
          </p>
        )}

        <button type="submit" disabled={busy || !vaultAvailable} className="fc-btn-primary mt-4 text-sm">
          {busy ? 'Saving…' : 'Save key'}
        </button>
      </form>

      <section className="rounded-xl border border-ink-200 bg-white p-5">
        <h2 className="text-base font-semibold text-ink-900">Your keys</h2>
        {keys.length === 0 ? (
          <p className="mt-2 text-sm text-ink-600">
            No keys stored. The assistant will use this server&apos;s key if one is configured, or
            FlowCare&apos;s deterministic parser if not.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {keys.map((k) => {
              const info = providers.find((p) => p.id === k.provider);
              return (
                <li key={k.provider} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-[10rem] grow">
                    <p className="text-sm font-semibold text-ink-900">{info?.label ?? k.provider}</p>
                    <p className="font-mono text-xs text-ink-500">{k.masked}</p>
                    <p className="text-xs text-ink-500">
                      {k.model ?? info?.defaultModel}
                      {k.useCount > 0 && ` · used ${k.useCount}×`}
                    </p>
                  </div>

                  <StatusChip status={k.status} />

                  <div className="flex gap-2">
                    <button
                      onClick={() => test(k.provider)}
                      disabled={testing !== null}
                      className="fc-btn-secondary !px-3 !py-1.5 text-xs"
                    >
                      {testing === k.provider ? 'Checking…' : 'Test key'}
                    </button>
                    <button
                      onClick={() => remove(k.provider)}
                      disabled={busy}
                      className="fc-btn-secondary !px-3 !py-1.5 text-xs text-rose-700"
                    >
                      Remove
                    </button>
                  </div>

                  {/* This session's check wins over the stored status: it
                      distinguishes a rejected key from a rate limit or an
                      outage, which the stored boolean cannot. */}
                  {checks[k.provider] ? (
                    <div className="w-full">
                      <CheckResult {...checks[k.provider]} />
                    </div>
                  ) : (
                    k.status === 'invalid' && k.lastError && (
                      <p className="w-full rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        {k.lastError}
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusChip({ status }: { status: StoredKey['status'] }) {
  // "Not checked" is a distinct state from "working". A key is only ever
  // called valid after a real round trip to the provider succeeded.
  const map = {
    valid: { text: 'Working', cls: 'bg-emerald-100 text-emerald-900' },
    invalid: { text: 'Not working', cls: 'bg-rose-100 text-rose-900' },
    unvalidated: { text: 'Not checked yet', cls: 'bg-ink-100 text-ink-700' },
  } as const;
  const s = map[status];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{s.text}</span>;
}

/**
 * The outcome of the most recent check.
 *
 * Six states rather than a tick or a cross, because the fixes differ: a
 * rejected key needs replacing, a rate-limited one needs waiting, and an
 * unreachable provider needs nothing at all from the user.
 */
export function CheckResult({
  status, message, model, checkedAt,
}: { status: string; message: string; model: string | null; checkedAt: string }) {
  const style: Record<string, { label: string; cls: string }> = {
    working:              { label: 'Working',             cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
    invalid_key:          { label: 'Key rejected',        cls: 'border-rose-200 bg-rose-50 text-rose-900' },
    rate_limited:         { label: 'Rate limited',        cls: 'border-amber-200 bg-amber-50 text-amber-900' },
    model_unavailable:    { label: 'Model not found',     cls: 'border-amber-200 bg-amber-50 text-amber-900' },
    provider_unavailable: { label: 'Provider unavailable',cls: 'border-ink-200 bg-ink-50 text-ink-800' },
    configuration_error:  { label: 'Configuration problem',cls: 'border-ink-200 bg-ink-50 text-ink-800' },
  };
  const s = style[status] ?? style.configuration_error;
  const when = new Date(checkedAt);
  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${s.cls}`}>
      <p className="font-bold">
        {status === 'working' ? '✓' : '✕'} {s.label}
      </p>
      <p className="mt-0.5">{message}</p>
      <p className="mt-1 opacity-70">
        {model ? `Model: ${model} · ` : ''}
        Checked {formatTime(checkedAt)}
      </p>
    </div>
  );
}
