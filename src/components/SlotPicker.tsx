'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconCalendar, IconChevron } from '@/components/Icons';

export interface PickableSlot {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  departmentLabel: string;
}

/**
 * Slot selection for an appointment REQUEST.
 *
 * Only the session id is sent. Hospital, department and time are resolved
 * server-side from that session, so the button cannot be used to request
 * something the hospital never published.
 */
export function SlotPicker({
  slots,
  signedIn,
  windowDays,
}: {
  slots: PickableSlot[];
  signedIn: boolean;
  windowDays: number;
}) {
  const router = useRouter();
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(sessionId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? 'Could not send the request. Please try again.');
        setBusy(false);
        return;
      }
      router.push(`/appointments/${body.data.appointment.id}`);
      router.refresh();
    } catch {
      setError('Could not reach FlowCare. Check your connection and try again.');
      setBusy(false);
    }
  }

  if (slots.length === 0) {
    return <p className="text-xs text-ink-500">No open sessions in the next {windowDays} days.</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] text-rose-900 ring-1 ring-rose-200">
          {error}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((s) => {
          const free = s.capacity - s.booked;
          const isOpen = openSlot === s.id;
          return (
            <div key={s.id} className="rounded-xl border border-ink-200 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <IconCalendar width={14} height={14} className="text-brand-600" />
                {new Date(s.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {s.startTime}–{s.endTime} · {free} of {s.capacity} slots free
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">{s.departmentLabel}</p>

              {!signedIn ? (
                <Link href="/account" className="fc-btn-ghost mt-2 w-full !min-h-[38px] !py-1.5 text-[11px]">
                  Sign in to request
                </Link>
              ) : !isOpen ? (
                <button
                  type="button"
                  onClick={() => { setOpenSlot(s.id); setError(null); }}
                  aria-label={`Request ${s.startTime} on ${s.date}`}
                  className="fc-btn-primary mt-2 w-full !min-h-[38px] !py-1.5 text-[11px]"
                >
                  Continue <IconChevron width={13} height={13} />
                </button>
              ) : (
                <div className="mt-2 space-y-2 border-t border-ink-200 pt-2">
                  <label className="block text-[11px] font-semibold text-ink-700" htmlFor={`reason-${s.id}`}>
                    Reason for the visit (optional)
                  </label>
                  <input
                    id={`reason-${s.id}`}
                    value={reason}
                    maxLength={280}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. follow-up on last month's visit"
                    className="w-full rounded-lg border border-ink-200 px-2 py-1.5 text-[11px]"
                  />
                  <p className="text-[10px] text-ink-500">
                    This goes to the hospital's front desk as written. Do not describe an emergency here — for an
                    emergency, go to the emergency department or call 108.
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submit(s.id)}
                      className="fc-btn-primary flex-1 !min-h-[38px] !py-1.5 text-[11px] disabled:opacity-60"
                    >
                      {busy ? 'Sending…' : 'Request this slot'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { setOpenSlot(null); setReason(''); }}
                      className="fc-btn-ghost !min-h-[38px] !py-1.5 text-[11px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-ink-500">
        Requesting a slot does not confirm it. The hospital confirms or declines, and FlowCare shows the outcome on
        your visits page.
      </p>
    </div>
  );
}
