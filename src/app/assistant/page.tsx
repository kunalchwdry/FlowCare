'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { HospitalCard, type ResultWithEvidence } from '@/components/HospitalCard';
import { IconInfo, IconMic, IconPin, IconSparkles, IconStop, IconVolume } from '@/components/Icons';
import { label } from '@/lib/discovery/filters';
import { trackEvent, useGeolocation, useSessionId } from '@/lib/client/hooks';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

interface ConversationMessage { role: 'user' | 'assistant'; content: string }

/** Browser speech APIs are not included in every TypeScript DOM lib. Keep the
 * integration narrow so speech remains an optional enhancement, not a server
 * dependency or a reason for the assistant to fail. */
type SpeechResult = { 0: { transcript: string } };
type SpeechResultList = { length: number; [index: number]: SpeechResult };
type SpeechEvent = Event & { results: SpeechResultList };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

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
  'Show hospitals with dermatology and good FlowCare reviews.',
  'I prefer something closer even if it has fewer reviews.',
  'Find a hospital with cardiology available this week',
  'Wheelchair accessible hospital with Marathi-speaking staff',
];

function ChatBubble({ role, children }: { role: ConversationMessage['role']; children: React.ReactNode }) {
  const user = role === 'user';
  return (
    <div className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[88%] items-end gap-2 sm:max-w-[76%] ${user ? 'flex-row-reverse' : ''}`}>
        {!user && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700">
            <IconSparkles width={14} height={14} />
          </span>
        )}
        <div
          className={user
            ? 'rounded-2xl rounded-br-md bg-brand-600 px-4 py-3 text-sm leading-relaxed text-white shadow-sm'
            : 'rounded-2xl rounded-bl-md border border-ink-200 bg-white px-4 py-3 text-sm leading-relaxed text-ink-800 shadow-sm'}
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
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseRef = useRef('');

  useEffect(() => {
    const available = Boolean(
      (window.SpeechRecognition || window.webkitSpeechRecognition) && 'speechSynthesis' in window,
    );
    setSpeechAvailable(available);
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const toggleListening = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new Recognition();
    speechBaseRef.current = query.trim();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index][0].transcript).join(' ');
      setQuery(`${speechBaseRef.current} ${transcript}`.trim());
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
      setError('Voice input could not start. Check your microphone permission or type your request instead.');
    };
    recognitionRef.current = recognition;
    setError(null);
    setIsListening(true);
    recognition.start();
  };

  const speak = (text: string) => {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    if (isSpeaking && speakingText === text) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setSpeakingText(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    utterance.rate = 0.95;
    utterance.onstart = () => { setIsSpeaking(true); setSpeakingText(text); };
    utterance.onend = () => { setIsSpeaking(false); setSpeakingText(null); };
    utterance.onerror = () => { setIsSpeaking(false); setSpeakingText(null); };
    window.speechSynthesis.speak(utterance);
  };

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
    setBusy(true); setError(null); setQuery('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-flowcare-session': sessionId },
        body: JSON.stringify({ message: trimmed, history, location: geo.point }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error?.message ?? 'The assistant could not run that search.'); return; }
      setData(j.data);
      if (autoRead) window.setTimeout(() => speak(j.data.reply), 0);
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
    setHistory([]); setData(null); setError(null); setQuery('');
  };

  const showSearchDetails = Boolean(
    data && (data.total > 0 || data.emptyReason || data.understood.explanation.length > 0 || data.results.length > 0),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 py-2">
      <section className="overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-sm">
        <header className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-4 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-700">
            <IconSparkles width={20} height={20} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold text-ink-950 sm:text-lg">FlowCare Hospital Assistant</h1>
            <p className="truncate text-xs text-ink-500">Hospital discovery and appointment navigation</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Server-managed
            </span>
            {history.length > 0 && (
              <button type="button" onClick={reset} className="fc-btn-secondary !min-h-[34px] !px-3 text-xs">
                New chat
              </button>
            )}
          </div>
        </header>

        <div className="bg-ink-50/70 px-3 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto min-h-[320px] max-w-3xl space-y-4 rounded-2xl bg-ink-100/70 p-3 sm:min-h-[380px] sm:p-5">
            <ChatBubble role="assistant">
              <p className="font-semibold text-ink-950">Hi, I&apos;m FlowCare&apos;s hospital assistant.</p>
              <p className="mt-1 text-sm text-ink-600">
                Tell me what kind of hospital or appointment you&apos;re looking for and I&apos;ll search FlowCare&apos;s verified records.
              </p>
              <p className="mt-2 text-[11px] text-ink-500">I don&apos;t diagnose, recommend treatment, or decide how urgent a situation is.</p>
              <button
                type="button"
                onClick={() => speak('Hi, I am FlowCare\'s hospital assistant. Tell me what kind of hospital or appointment you are looking for and I will search FlowCare\'s verified records.')}
                disabled={!speechAvailable}
                className="mt-3 inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-bold text-violet-800 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSpeaking && speakingText?.startsWith('Hi, I am FlowCare') ? <IconStop width={13} height={13} /> : <IconVolume width={13} height={13} />}
                {isSpeaking && speakingText?.startsWith('Hi, I am FlowCare') ? 'Stop intro' : 'Listen to intro'}
              </button>
            </ChatBubble>

            {history.map((message, index) => (
              <ChatBubble key={`${message.role}-${index}`} role={message.role}>
                <div>{message.content}</div>
                {message.role === 'assistant' && (
                  <button
                    type="button"
                    onClick={() => speak(message.content)}
                    disabled={!speechAvailable}
                    className="mt-2 inline-flex min-h-[30px] items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1 text-[10px] font-bold text-ink-600 transition hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSpeaking && speakingText === message.content ? <IconStop width={12} height={12} /> : <IconVolume width={12} height={12} />}
                    {isSpeaking && speakingText === message.content ? 'Stop' : 'Listen'}
                  </button>
                )}
              </ChatBubble>
            ))}

            {busy && (
              <ChatBubble role="assistant">
                <div className="flex items-center gap-1.5 text-ink-500" aria-label="Assistant is searching">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400 [animation-delay:300ms]" />
                  <span className="ml-1 text-xs">Searching FlowCare…</span>
                </div>
              </ChatBubble>
            )}

            {error && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {error}
              </div>
            )}
            <div ref={threadEndRef} />
          </div>

          {!history.length && !busy && (
            <div className="mx-auto mt-4 max-w-3xl">
              <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">Try asking</p>
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.slice(0, 4).map((example) => (
                  <button key={example} type="button" onClick={() => ask(example)} className="fc-chip-off !text-[11px]">
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-ink-200 bg-white px-3 py-3 sm:px-6 sm:py-4">
          <div className="mx-auto max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-brand-50 px-3 py-2.5">
              <div className="mr-auto flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-600 text-white shadow-sm"><IconMic width={16} height={16} /></span>
                <div>
                  <p className="text-xs font-extrabold text-ink-900">Talk to FlowCare</p>
                  <p className="text-[10px] text-ink-500">Speak your request or listen to the assistant</p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleListening}
                disabled={!speechAvailable}
                aria-pressed={isListening}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold transition ${isListening ? 'bg-rose-600 text-white shadow-sm' : 'bg-violet-600 text-white hover:bg-violet-700'} disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500`}
              >
                <IconMic width={14} height={14} />
                {isListening ? 'Listening…' : 'Speak'}
              </button>
              <button
                type="button"
                onClick={() => data?.reply && speak(data.reply)}
                disabled={!speechAvailable || !data?.reply}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-[11px] font-bold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSpeaking ? <IconStop width={14} height={14} /> : <IconVolume width={14} height={14} />}
                {isSpeaking ? 'Stop audio' : 'Read reply'}
              </button>
              <label className="inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-xl px-2 py-1.5 text-[10px] font-semibold text-ink-600">
                <input type="checkbox" checked={autoRead} onChange={(e) => setAutoRead(e.target.checked)} className="h-3.5 w-3.5 accent-violet-600" />
                Auto-read
              </label>
            </div>
            {!speechAvailable && (
              <p className="mb-2 text-[10px] text-ink-500">Voice controls are unavailable in this browser. You can still type your request.</p>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-ink-300 bg-white p-1.5 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
              <textarea
                id="assistant-q"
                className="max-h-32 min-h-[42px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400"
                value={query}
                maxLength={400}
                rows={1}
                placeholder="Message FlowCare…"
                aria-label="Message FlowCare assistant"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask(query);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => ask(query)}
                disabled={busy || !query.trim()}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800">FlowCare AI</span>
                <button
                  type="button"
                  onClick={geo.request}
                  className={`inline-flex min-h-[28px] items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${geo.point ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50'}`}
                >
                  <IconPin width={13} height={13} /> {geo.point ? 'Location on' : 'Use my location'}
                </button>
              </div>
              <span className="text-[10px] text-ink-400">Enter to send · Shift + Enter for a new line</span>
            </div>
            {!anyConfigured && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200">
                The application Gemini key is not configured on this deployment yet. FlowCare can still search using its deterministic parser.
              </p>
            )}
          </div>
        </div>
      </section>

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

          {showSearchDetails && (
            <section className="fc-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold">Search details</h2>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    FlowCare checked your request against its allowed filters and verified records.
                  </p>
                </div>
                <Link
                  href={`/hospitals?${new URLSearchParams(
                    Object.entries(data.understood.filters)
                      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
                      .map(([key, value]) => [key, String(value)]),
                  ).toString()}`}
                  className="text-xs font-semibold text-brand-700 underline"
                >
                  Open full discovery
                </Link>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(data.understood.filters)
                  .filter(([key, value]) => !['page', 'pageSize', 'sort'].includes(key) && value !== undefined && value !== null && (!Array.isArray(value) || value.length))
                  .map(([key, value]) => (
                    <span key={key} className="fc-pill bg-brand-50 text-brand-800 ring-1 ring-brand-200">
                      <span className="opacity-70">{key}</span>
                      <span className="font-bold">
                        {Array.isArray(value) ? value.map((x) => label(String(x))).join(', ')
                          : typeof value === 'object' ? `${(value as { lat: number }).lat.toFixed(2)}, ${(value as { lng: number }).lng.toFixed(2)}`
                            : String(value)}
                      </span>
                    </span>
                  ))}
              </div>

              {data.understood.explanation.length > 0 && (
                <ul className="mt-2.5 space-y-0.5 text-[11px] text-ink-600">
                  {data.understood.explanation.map((note, index) => <li key={index}>• {note}</li>)}
                </ul>
              )}

              <p className="mt-3 text-[10px] text-ink-400">
                Hospital names, availability, and details below come from FlowCare and Google data, not generated text.
              </p>
            </section>
          )}

          {showSearchDetails && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold">{data.total} hospital{data.total === 1 ? '' : 's'} matched</h2>
                {data.total > 0 && <span className="text-[11px] text-ink-500">Verified result cards</span>}
              </div>

              {data.total > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.results.map((result) => <HospitalCard key={result.hospital.id} result={result} />)}
                </div>
              ) : (
                <div className="fc-card p-6 text-center">
                  <p className="text-base font-bold">No hospitals matched</p>
                  <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-600">{data.emptyReason}</p>
                  <Link href="/hospitals" className="fc-btn-primary mt-4">Browse all hospitals</Link>
                </div>
              )}
            </div>
          )}

          <p className="text-center text-[10px] text-ink-400">FlowCare data as of {formatDateTime(data.computedAt)}</p>
        </>
      )}

      <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-ink-400">
        <IconInfo width={12} height={12} />
        FlowCare helps you find and compare hospitals. It does not provide medical advice.
      </p>
    </div>
  );
}
