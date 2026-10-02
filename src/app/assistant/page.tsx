'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HospitalCard, type ResultWithEvidence } from '@/components/HospitalCard';
import { IconInfo, IconPin, IconSparkles } from '@/components/Icons';
import { label } from '@/lib/discovery/filters';
import { trackEvent, useGeolocation, useSessionId } from '@/lib/client/hooks';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

interface ProviderInfo { id: string; label: string; note: string; configured: boolean; model: string }

interface AssistantResponse {
  understood: {
    filters: Record<string, unknown>;
    explanation: string[];
    source: 'llm' | 'deterministic' | 'llm_rejected_fallback';
    provider: string | null;
    model: string | null;
    latencyMs: number | null;
  };
  aiUnavailableReason: string | null;
  safetyNotice: string | null;
  scopeNotice: string;
  locationNotice: string | null;
  results: ResultWithEvidence[];
  total: number;
  emptyReason: string | null;
  computedAt: string;
}

const EXAMPLES = [
  'I need a hospital with a cardiology department near Pune.',
  'Which nearby hospitals have appointments available?',
  'Show hospitals with dermatology and good FlowCare reviews.',
  'I prefer something closer even if it has fewer reviews.',
  'Find a hospital with cardiology available this week',
  'Wheelchair accessible hospital with Marathi-speaking staff',
];

export default function AssistantPage() {
  const sessionId = useSessionId();
  const geo = useGeolocation();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [anyConfigured, setAnyConfigured] = useState(true);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/assistant/providers')
      .then((r) => r.json())
      .then((j) => {
        setProviders(j.data.providers);
        setAnyConfigured(j.data.anyConfigured);
        const def = j.data.providers.find((p: ProviderInfo) => p.id === j.data.defaultProvider && p.configured)
          ?? j.data.providers.find((p: ProviderInfo) => p.configured);
        setProvider(def?.id ?? '');
      })
      .catch(() => {});
  }, []);

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-flowcare-session': sessionId },
        body: JSON.stringify({ query: q, provider: provider || null, location: geo.point }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error?.message ?? 'The assistant could not run that search.'); return; }
      setData(j.data);
      trackEvent('assistant_query', sessionId, { result_count: j.data.total });
    } catch {
      setError('Could not reach the assistant. You can still search with filters.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      <header className="fc-card p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700"><IconSparkles width={18} height={18} /></span>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">FlowCare Hospital Assistant</h1>
            <p className="text-xs text-ink-500">Finds and filters hospitals. It does not give medical advice.</p>
          </div>
        </div>

        <p className="mt-3 rounded-xl bg-ink-100 px-3 py-2.5 text-[11px] leading-relaxed text-ink-600">
          <IconInfo width={13} height={13} className="mr-1 inline" />
          This assistant is a hospital discovery and appointment navigation tool. It does not diagnose, recommend
          treatment, decide how urgent your situation is, or make any clinical decision. For anything urgent, contact
          your local emergency services or a clinician directly.
        </p>

        <div className="mt-3">
          <label className="fc-label" htmlFor="assistant-q">What are you looking for?</label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id="assistant-q"
              className="fc-input flex-1"
              value={query}
              maxLength={400}
              placeholder="e.g. cardiology hospital near me with an appointment this week"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask(query)}
            />
            <button onClick={() => ask(query)} disabled={busy || !query.trim()} className="fc-btn-primary sm:w-auto">
              {busy ? 'Searching…' : 'Find hospitals'}
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
              AI provider
              <select
                className="rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-ink-800"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="">FlowCare parser (no AI)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.configured}>
                    {p.label}{p.configured ? ` · ${p.model}` : ' · not configured'}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={geo.request}
              className={`fc-chip-off !min-h-[32px] ${geo.point ? '!border-brand-300 !bg-brand-50 !text-brand-700' : ''}`}
            >
              <IconPin width={13} height={13} /> {geo.point ? 'Using your location' : 'Use my location'}
            </button>
          </div>

          {!anyConfigured && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">
              No AI provider is configured on this deployment. The assistant is using FlowCare&apos;s deterministic parser,
              which understands departments, locations, availability, ratings, accessibility and language requests.
            </p>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setQuery(ex); ask(ex); }} className="fc-chip-off !text-[11px]">{ex}</button>
          ))}
        </div>
      </header>

      {error && <p className="fc-card p-4 text-sm font-semibold text-rose-700">{error}</p>}

      {data && (
        <>
          {data.safetyNotice && (
            <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-bold text-rose-900">If this may be urgent</p>
              <p className="mt-1 text-xs leading-relaxed text-rose-800">{data.safetyNotice}</p>
            </div>
          )}

          {data.aiUnavailableReason && (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              {data.aiUnavailableReason}
            </p>
          )}

          {data.locationNotice && (
            <p className="rounded-xl bg-ink-100 px-3 py-2.5 text-xs text-ink-700">{data.locationNotice}</p>
          )}

          <section className="fc-card p-4">
            <h2 className="text-sm font-bold">What FlowCare searched for</h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              Your sentence was converted into these validated filters
              {data.understood.source === 'llm' && data.understood.provider
                ? ` by ${data.understood.provider} (${data.understood.model}${data.understood.latencyMs ? `, ${data.understood.latencyMs} ms` : ''}), then checked against FlowCare's allowed filter list`
                : data.understood.source === 'llm_rejected_fallback'
                  ? " by FlowCare's own parser after the AI response was rejected"
                  : " by FlowCare's own deterministic parser"}.
            </p>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {Object.entries(data.understood.filters)
                .filter(([k, v]) => !['page', 'pageSize', 'sort'].includes(k) && v !== undefined && v !== null && (!Array.isArray(v) || v.length))
                .map(([k, v]) => (
                  <span key={k} className="fc-pill bg-brand-50 text-brand-800 ring-1 ring-brand-200">
                    <span className="opacity-70">{k}</span>
                    <span className="font-bold">
                      {Array.isArray(v) ? v.map((x) => label(String(x))).join(', ')
                        : typeof v === 'object' ? `${(v as { lat: number }).lat.toFixed(2)}, ${(v as { lng: number }).lng.toFixed(2)}`
                        : String(v)}
                    </span>
                  </span>
                ))}
            </div>

            {data.understood.explanation.length > 0 && (
              <ul className="mt-2.5 space-y-0.5 text-[11px] text-ink-600">
                {data.understood.explanation.map((n, i) => <li key={i}>• {n}</li>)}
              </ul>
            )}

            <p className="mt-2.5 text-[10px] text-ink-400">
              The model can only choose from a fixed vocabulary of filters. It never writes a database query, never
              names a hospital, and everything below comes from FlowCare and Google data — not generated text.
            </p>
          </section>

          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold">{data.total} hospital{data.total === 1 ? '' : 's'} matched</h2>
            <Link
              href={`/hospitals?${new URLSearchParams(
                Object.entries(data.understood.filters)
                  .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
                  .map(([k, v]) => [k, String(v)]),
              ).toString()}`}
              className="text-xs font-semibold text-brand-700 underline"
            >
              Open in full discovery view
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {data.results.map((r) => <HospitalCard key={r.hospital.id} result={r} />)}
          </div>

          {data.total === 0 && (
            <div className="fc-card p-8 text-center">
              <p className="text-base font-bold">No hospitals matched</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">{data.emptyReason}</p>
              <Link href="/hospitals" className="fc-btn-primary mt-4">Browse all hospitals</Link>
            </div>
          )}

          <p className="text-center text-[10px] text-ink-400">FlowCare data as of {formatDateTime(data.computedAt)}</p>
        </>
      )}
    </div>
  );
}
