'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { HospitalCard, type ResultWithEvidence } from '@/components/HospitalCard';
import { IconInfo, IconPin, IconSparkles } from '@/components/Icons';
import { label } from '@/lib/discovery/filters';
import { trackEvent, useGeolocation, useSessionId } from '@/lib/client/hooks';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

interface ConversationMessage { role: 'user' | 'assistant'; content: string }

interface AssistantResponse {
  reply: string;
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
  'Show hospitals with dermatology near me.',
  'Wheelchair accessible hospital with Marathi-speaking staff',
];

function ChatBubble({ role, children }: { role: ConversationMessage['role']; children: React.ReactNode }) {
  const user = role === 'user';
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[92%] items-start gap-3 sm:max-w-[78%] ${user ? 'flex-row-reverse' : ''}`}>
        {!user && (
          <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700">
            <IconSparkles width={15} height={15} />
          </span>
        )}
        <div className={user
          ? 'rounded-2xl rounded-br-md bg-brand-600 px-4 py-3 text-sm leading-relaxed text-white shadow-sm'
          : 'rounded-2xl rounded-bl-md bg-white px-1 py-2 text-sm leading-relaxed text-ink-800'}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AssistantPage() {
  const sessionId = useSessionId();
  const geo = useGeolocation();
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const [anyConfigured, setAnyConfigured] = useState(false);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/assistant/providers')
      .then((r) => r.json())
      .then((j) => setAnyConfigured(Boolean(j.data?.anyConfigured)))
      .catch(() => setAnyConfigured(false));
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, busy, data, error]);

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setQuery('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-flowcare-session': sessionId },
        body: JSON.stringify({ message: trimmed, history, location: geo.point }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error?.message ?? 'The assistant could not run that search.');
        return;
      }
      setData(j.data);
      const nextHistory: ConversationMessage[] = [
        ...history,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: j.data.reply },
      ];
      setHistory(nextHistory.slice(-12));
      trackEvent('assistant_query', sessionId, { result_count: j.data.total });
    } catch {
      setError('Could not reach the assistant. You can still search with filters.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setHistory([]);
    setData(null);
    setError(null);
    setQuery('');
  };

  const showSearchDetails = Boolean(
    data && (data.total > 0 || data.emptyReason || data.understood.explanation.length > 0 || data.results.length > 0),
  );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-4xl flex-col gap-4 py-2 sm:gap-5">
      <section className="flex min-h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-sm">
        <header className="flex items-center gap-3 border-b border-ink-200 px-4 py-3.5 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700">
            <IconSparkles width={20} height={20} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold text-ink-950 sm:text-lg">FlowCare Hospital Assistant</h1>
            <p className="truncate text-xs text-ink-500">Search hospitals and appointment options</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
            </span>
            {history.length > 0 && (
              <button type="button" onClick={reset} className="fc-btn-secondary !min-h-[34px] !px-3 text-xs">New chat</button>
            )}
          </div>
        </header>

        <div className="flex-1 bg-white px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-3xl">
            {history.length === 0 ? (
              <div className="grid min-h-[46vh] place-items-center text-center">
                <div className="max-w-xl">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-violet-100 text-violet-700 shadow-sm">
                    <IconSparkles width={28} height={28} />
                  </span>
                  <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-ink-950 sm:text-3xl">How can I help you today?</h2>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-500">
                    Ask about hospitals, departments, accessibility, locations or published appointment availability.
                  </p>
                  <div className="mt-7 flex flex-wrap justify-center gap-2">
                    {EXAMPLES.map((example) => (
                      <button key={example} type="button" onClick={() => ask(example)} className="fc-chip-off !min-h-[38px] !text-[11px]">
                        {example}
                      </button>
                    ))}
                  </div>
                  <p className="mt-6 text-[11px] text-ink-400">FlowCare does not diagnose or provide emergency medical advice.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-6 pb-4">
                {history.map((message, index) => (
                  <ChatBubble key={`${message.role}-${index}`} role={message.role}>{message.content}</ChatBubble>
                ))}
                {busy && (
                  <ChatBubble role="assistant">
                    <div className="flex items-center gap-1.5 py-2 text-ink-500" aria-label="Assistant is searching">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                      <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400 [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400 [animation-delay:300ms]" />
                      <span className="ml-1 text-xs">Searching FlowCare…</span>
                    </div>
                  </ChatBubble>
                )}
                {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}
                <div ref={threadEndRef} />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-ink-200 bg-white px-4 py-4 sm:px-8">
          <form onSubmit={(event) => { event.preventDefault(); void ask(query); }} className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-3xl border border-ink-300 bg-white p-2 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
              <textarea
                id="assistant-q"
                className="max-h-32 min-h-[42px] flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400"
                value={query}
                maxLength={400}
                rows={1}
                placeholder="Message FlowCare…"
                aria-label="Message FlowCare assistant"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(query);
                  }
                }}
              />
              <button type="submit" disabled={busy || !query.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-lg font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400" aria-label="Send message">↑</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800">FlowCare AI</span>
                <button type="button" onClick={geo.request} className={`inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${geo.point ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50'}`}>
                  <IconPin width={13} height={13} /> {geo.point ? 'Location on' : 'Use my location'}
                </button>
              </div>
              <span className="text-[10px] text-ink-400">Enter to send · Shift + Enter for a new line</span>
            </div>
            {!anyConfigured && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">FlowCare is using its verified deterministic search mode on this deployment.</p>}
          </form>
        </div>
      </section>

      {data && (
        <>
          {data.safetyNotice && <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4"><p className="text-sm font-bold text-rose-900">If this may be urgent</p><p className="mt-1 text-xs leading-relaxed text-rose-800">{data.safetyNotice}</p></div>}
          {data.aiUnavailableReason && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">{data.aiUnavailableReason}</p>}
          {data.locationNotice && <p className="rounded-xl bg-ink-100 px-3 py-2.5 text-xs text-ink-700">{data.locationNotice}</p>}

          {showSearchDetails && (
            <section className="fc-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-sm font-bold">Search details</h2><p className="mt-0.5 text-[11px] text-ink-500">FlowCare checked your request against verified records.</p></div>
                <Link href={`/hospitals?${new URLSearchParams(Object.entries(data.understood.filters).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([key, value]) => [key, String(value)])).toString()}`} className="text-xs font-semibold text-brand-700 underline">Open full discovery</Link>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(data.understood.filters).filter(([key, value]) => !['page', 'pageSize', 'sort'].includes(key) && value !== undefined && value !== null && (!Array.isArray(value) || value.length)).map(([key, value]) => (
                  <span key={key} className="fc-pill bg-brand-50 text-brand-800 ring-1 ring-brand-200"><span className="opacity-70">{key}</span><span className="font-bold">{Array.isArray(value) ? value.map((x) => label(String(x))).join(', ') : typeof value === 'object' ? `${(value as { lat: number }).lat.toFixed(2)}, ${(value as { lng: number }).lng.toFixed(2)}` : String(value)}</span></span>
                ))}
              </div>
              {data.understood.explanation.length > 0 && <ul className="mt-2.5 space-y-0.5 text-[11px] text-ink-600">{data.understood.explanation.map((note, index) => <li key={index}>• {note}</li>)}</ul>}
              <p className="mt-3 text-[10px] text-ink-400">Hospital names and availability below come from FlowCare records, not generated text.</p>
            </section>
          )}

          {showSearchDetails && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between"><h2 className="text-sm font-bold">{data.total} hospital{data.total === 1 ? '' : 's'} matched</h2>{data.total > 0 && <span className="text-[11px] text-ink-500">Verified result cards</span>}</div>
              {data.total > 0 ? <div className="grid gap-3 sm:grid-cols-2">{data.results.map((result) => <HospitalCard key={result.hospital.id} result={result} />)}</div> : <div className="fc-card p-6 text-center"><p className="text-base font-bold">No hospitals matched</p><p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">{data.emptyReason}</p><Link href="/hospitals" className="fc-btn-primary mt-4">Browse all hospitals</Link></div>}
            </div>
          )}
          <p className="text-center text-[10px] text-ink-400">FlowCare data as of {formatDateTime(data.computedAt)}</p>
        </>
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-ink-400"><IconInfo width={12} height={12} />FlowCare helps you find and compare hospitals. It does not provide medical advice.</p>
    </div>
  );
}
