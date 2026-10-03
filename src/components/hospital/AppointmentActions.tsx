'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  actionLabel,
  actionNeedsReason,
  actionNeedsSlot,
  availableActions,
  type Action,
} from '@/lib/appointments/stateMachine';

interface SlotOption { id: string; label: string }

/**
 * Buttons for a single appointment row.
 *
 * These post an *action name* and the row's version. They never post a
 * status, and they never update local state optimistically: the server
 * decides, and the page re-reads. If the request fails the row stays exactly
 * as it was, which is the behaviour you want when two receptionists are
 * looking at the same screen.
 *
 * Destructive moves open a confirm step that collects the mandatory reason,
 * because the reason is shown to the patient verbatim.
 */
export function AppointmentActions({
  appointmentId,
  status,
  version,
  permissions,
  slots,
}: {
  appointmentId: string;
  status: string;
  version: number;
  permissions: string[];
  slots: SlotOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [slotId, setSlotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = availableActions(status as never, 'hospital', permissions);
  if (actions.length === 0) return <span className="text-xs text-ink-400">No actions</span>;

  async function run(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hospital/appointments/${appointmentId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          expectedVersion: version,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(slotId ? { proposedSessionId: slotId } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? 'That did not work. Please try again.');
        return;
      }
      setOpen(null);
      setReason('');
      setSlotId('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function start(a: Action) {
    setError(null);
    if (actionNeedsReason(a) || actionNeedsSlot(a)) {
      setOpen(a);
      return;
    }
    void run(a);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={busy}
            onClick={() => start(a)}
            className={
              a === 'accept'
                ? 'rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50'
                : 'rounded-lg border border-ink-300 px-2.5 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50'
            }
          >
            {actionLabel(a)}
          </button>
        ))}
      </div>

      {open && (
        <div className="rounded-lg border border-ink-300 bg-ink-50 p-3">
          <p className="text-xs font-bold text-ink-800">{actionLabel(open)}</p>

          {actionNeedsSlot(open) && (
            <label className="mt-2 block">
              <span className="text-[11px] font-semibold text-ink-700">Move to this time</span>
              <span className="mt-0.5 block text-[10px] text-amber-800">
                This takes effect immediately — the patient is not asked first.
                Tell them before you move it.
              </span>
              <select
                value={slotId}
                onChange={(e) => setSlotId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-300 px-2 py-1.5 text-xs"
              >
                <option value="">Choose a session…</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
          )}

          {actionNeedsReason(open) && (
            <label className="mt-2 block">
              <span className="text-[11px] font-semibold text-ink-700">
                Reason
              </span>
              <span className="mt-0.5 block text-[10px] text-amber-800">
                Not stored yet against the live database — this schema has no field
                for it. Please also tell the patient directly.
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={280}
                placeholder="e.g. The consultant is on leave that morning"
                className="mt-1 w-full rounded-lg border border-ink-300 px-2 py-1.5 text-xs"
              />
            </label>
          )}

          {error && <p className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(open)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setOpen(null); setError(null); }}
              className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-semibold text-ink-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && !open && <p className="text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
