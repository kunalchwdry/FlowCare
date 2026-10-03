'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateTime } from '@/lib/time';
import type { AppointmentMessage } from '@/lib/types';

export function AppointmentMessages({
  appointmentId,
  audience,
  version,
  status,
  initialMessages,
  compact = false,
}: {
  appointmentId: string;
  audience: 'patient' | 'hospital';
  version: number;
  status: string;
  initialMessages?: AppointmentMessage[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!compact);
  const [messages, setMessages] = useState<AppointmentMessage[] | null>(initialMessages ?? (compact ? null : []));
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [responding, setResponding] = useState<'accept_reschedule' | 'decline_reschedule' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || messages !== null) return;
    const endpoint = audience === 'patient'
      ? `/api/appointments/${appointmentId}/messages`
      : `/api/hospital/appointments/${appointmentId}/messages`;
    fetch(endpoint)
      .then((r) => r.json())
      .then((j) => setMessages(j?.data?.messages ?? []))
      .catch(() => setError('Could not load the conversation.'));
  }, [appointmentId, audience, messages, open]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const endpoint = audience === 'patient'
      ? `/api/appointments/${appointmentId}/messages`
      : `/api/hospital/appointments/${appointmentId}/messages`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? 'Could not send the message.');
        return;
      }
      setMessages((current) => [...(current ?? []), json.data.message]);
      setBody('');
    } catch {
      setError('Could not reach FlowCare. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function answer(action: 'accept_reschedule' | 'decline_reschedule') {
    setResponding(action);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expectedVersion: version }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? 'Could not save your answer.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach FlowCare. Check your connection and try again.');
    } finally {
      setResponding(null);
    }
  }

  const hasPendingProposal = status === 'reschedule_proposed' &&
    (messages ?? []).some((m) => m.kind === 'time_proposal' && m.proposalStatus === 'pending');

  return (
    <section className={compact ? 'mt-2' : 'fc-card p-5'}>
      <div className="flex items-center gap-2">
        {!compact && <h2 className="text-sm font-bold">Messages with the hospital</h2>}
        {compact && <span className="text-xs font-semibold text-ink-700">Messages</span>}
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); if (!open && messages === null) setError(null); }}
          className="ml-auto text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          {open ? 'Hide' : 'Open'}
        </button>
      </div>

      {open && (
        <>
          {hasPendingProposal && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-950">The hospital suggested a new time</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-900">
                Review the message below, then accept it or keep your original appointment by declining it.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(responding)}
                  onClick={() => void answer('accept_reschedule')}
                  className="fc-btn-primary !min-h-[34px] !py-1 text-[11px] disabled:opacity-60"
                >
                  {responding === 'accept_reschedule' ? 'Saving…' : 'Accept new time'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(responding)}
                  onClick={() => void answer('decline_reschedule')}
                  className="fc-btn-secondary !min-h-[34px] !py-1 text-[11px] disabled:opacity-60"
                >
                  {responding === 'decline_reschedule' ? 'Saving…' : 'Decline · keep original'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {messages === null && <p className="text-xs text-ink-500">Loading conversation…</p>}
            {messages?.length === 0 && <p className="text-xs text-ink-500">No messages yet.</p>}
            {messages?.map((message) => (
              <div
                key={message.id}
                className={`rounded-xl px-3 py-2 text-xs ${
                  message.senderSide === audience ? 'ml-6 bg-brand-50 text-brand-950' : 'mr-6 bg-ink-50 text-ink-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-ink-500">
                  <span>{message.senderSide === 'hospital' ? 'Hospital' : message.senderSide === 'patient' ? 'You' : 'FlowCare'}</span>
                  <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
                </div>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{message.body}</p>
                {message.kind === 'time_proposal' && message.proposedFor && (
                  <p className="mt-2 rounded-lg bg-white/80 px-2 py-1.5 text-[11px] font-bold text-amber-900">
                    Suggested time: {formatDateTime(message.proposedFor)}
                  </p>
                )}
                {message.kind === 'time_response' && message.proposedFor && (
                  <p className="mt-1 text-[10px] text-ink-500">
                    Suggested time: {formatDateTime(message.proposedFor)}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-ink-100 pt-3">
            <label className="block text-[11px] font-semibold text-ink-700" htmlFor={`message-${appointmentId}`}>
              {audience === 'patient' ? 'Message the hospital' : 'Message the patient'}
            </label>
            <textarea
              id={`message-${appointmentId}`}
              value={body}
              maxLength={1000}
              rows={compact ? 2 : 3}
              onChange={(e) => setBody(e.target.value)}
              placeholder={audience === 'patient' ? 'Ask about this appointment…' : 'Write an update for the patient…'}
              className="mt-1 w-full rounded-lg border border-ink-300 px-2.5 py-2 text-xs"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[10px] text-ink-400">{body.length}/1000</span>
              <button
                type="button"
                disabled={busy || !body.trim()}
                onClick={() => void send()}
                className="ml-auto rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
          {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}
        </>
      )}
    </section>
  );
}
