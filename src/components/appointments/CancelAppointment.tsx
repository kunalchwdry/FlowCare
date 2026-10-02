'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Lets a patient cancel their own appointment.
 *
 * The browser sends an action and the row's version — never a status. The
 * database decides: `mutate_appointment` allows a cancel without any staff
 * permission only when `a.patient_id = private.actor()`, so this works for
 * your own appointment and fails for anybody else's regardless of what the
 * client sends.
 *
 * Two deliberate choices. There is a confirm step, because cancelling frees
 * the seat immediately and a mis-tap on a phone is easy. And the page is
 * re-read rather than updated optimistically, so what you see afterwards is
 * what the database actually holds.
 */
export function CancelAppointment({
  appointmentId,
  version,
  hospitalName,
}: {
  appointmentId: string;
  version: number;
  hospitalName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          expectedVersion: version,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? 'That did not work. Please try again.');
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen(true); }}
        className="rounded-lg border border-ink-300 px-2.5 py-1.5 text-[11px] font-semibold text-ink-700 hover:bg-ink-50"
      >
        Cancel appointment
      </button>
    );
  }

  return (
    <div
      className="w-full rounded-lg border border-ink-300 bg-ink-50 p-3"
      onClick={(e) => e.preventDefault()}
    >
      <p className="text-xs font-bold text-ink-900">Cancel this appointment?</p>
      <p className="mt-1 text-xs text-ink-600">
        {hospitalName} will be told, and the slot is released for someone else. You would need
        to request a new appointment to come back.
      </p>

      <label className="mt-2 block">
        <span className="text-[11px] font-semibold text-ink-700">Reason (optional)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={280}
          placeholder="e.g. I am no longer able to attend"
          className="mt-1 w-full rounded-lg border border-ink-300 px-2 py-1.5 text-xs"
        />
      </label>

      {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { setOpen(false); setError(null); }}
          className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-semibold text-ink-700"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
