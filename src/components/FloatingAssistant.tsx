'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { FlowCareMark } from '@/components/Brand';
import { IconClose } from '@/components/Icons';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const WELCOME: ChatMessage = {
  role: 'assistant',
  content: 'Hi! I can help you find and compare hospitals, departments, accessibility options, and available appointments.',
};

/**
 * Compact, typed-only assistant launcher for the patient app. The full-page
 * assistant is intentionally not used; this bubble is the single assistant
 * entry point and talks to the same server-owned /api/chat contract.
 */
export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          history: messages.slice(-10),
          location: null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error?.message ?? 'The assistant could not respond.');
      }
      setMessages([...nextMessages, { role: 'assistant', content: payload.data.reply }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The assistant could not respond.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([WELCOME]);
    setDraft('');
    setError(null);
  }

  return (
    <div className="pointer-events-none fixed bottom-[76px] right-4 z-50 sm:bottom-6 sm:right-6">
      {open && (
        <section
          className="pointer-events-auto mb-3 flex h-[min(520px,calc(100vh-120px))] w-[min(370px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-2xl"
          aria-label="FlowCare floating assistant"
        >
          <header className="flex items-center gap-2.5 border-b border-ink-200 bg-white px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <FlowCareMark size={21} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-extrabold text-ink-900">FlowCare Assistant</h2>
              <p className="text-[11px] text-ink-500">Hospital discovery and appointments</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg px-2 py-1 text-[11px] font-semibold text-ink-500 hover:bg-ink-50"
              >
                New
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:bg-ink-100"
                aria-label="Close FlowCare assistant"
              >
                <IconClose width={16} height={16} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-ink-50/40 px-3 py-4" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <p
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    message.role === 'user'
                      ? 'rounded-br-md bg-brand-600 text-white'
                      : 'rounded-bl-md border border-ink-200 bg-white text-ink-700'
                  }`}
                >
                  {message.content}
                </p>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <p className="rounded-2xl rounded-bl-md border border-ink-200 bg-white px-3.5 py-2.5 text-xs text-ink-500">
                  Checking FlowCare…
                </p>
              </div>
            )}
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="border-t border-ink-200 bg-white p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-ink-300 bg-white p-1.5 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={1}
                maxLength={400}
                placeholder="Ask FlowCare…"
                aria-label="Message FlowCare assistant"
                className="max-h-20 min-h-[34px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-xs text-ink-900 outline-none placeholder:text-ink-400"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400"
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-ink-400">FlowCare helps you discover care; it does not diagnose.</p>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`pointer-events-auto ml-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-600 text-white shadow-xl shadow-brand-600/25 ring-4 ring-white transition hover:-translate-y-0.5 hover:bg-brand-700 focus:outline-none focus:ring-brand-200 ${open ? 'rotate-0' : ''}`}
        aria-label={open ? 'Close FlowCare assistant' : 'Open FlowCare assistant'}
        aria-expanded={open}
      >
        {open ? <IconClose width={25} height={25} /> : <FlowCareMark size={31} title="FlowCare assistant" />}
        {!open && <span className="sr-only">Open FlowCare assistant</span>}
      </button>
    </div>
  );
}
