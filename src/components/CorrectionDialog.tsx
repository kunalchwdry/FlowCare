'use client';

/**
 * F17 — "Report something wrong" from the hospital profile.
 *
 * The copy here is doing real work. A patient who reports a dead phone
 * number must not come away believing the number is now fixed: S01 shows
 * directories decay precisely because reports vanish into nothing, and the
 * fix for that is a visible queue, not a silent one. So the success state
 * says a person will check it, and the button never says "Update".
 */
import { useState } from 'react';
import { IconCheck, IconInfo } from './Icons';
import { CORRECTION_FIELDS, EVIDENCE_KINDS } from '@/lib/journey/vocab';

const FIELD_LABELS: Record<string, string> = {
  phone: 'Phone number',
  address: 'Address',
  hours: 'Opening hours',
  services: 'A service that is listed',
  schemes: 'Scheme acceptance',
  charges: 'Published charges',
  accessibility: 'Accessibility detail',
  languages: 'Language support',
  arrival: 'Gate or counter details',
  routes: 'Directions inside the hospital',
  prep: 'What to bring',
};

export function CorrectionDialog({
  hospitalId,
  hospitalName,
  defaultField,
  onClose,
}: {
  hospitalId: string;
  hospitalName: string;
  defaultField?: string;
  onClose: () => void;
}) {
  const [fieldCode, setFieldCode] = useState(defaultField ?? 'phone');
  const [evidenceKind, setEvidenceKind] = useState<string>('i_called');
  const [claimedValue, setClaimedValue] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setMessage(null);
    try {
      const res = await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalId,
          fieldCode,
          evidenceKind,
          ...(claimedValue.trim() ? { claimedValue: claimedValue.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setState('error');
        setMessage(j.error?.message ?? 'Could not send that report.');
        return;
      }
      setState('done');
      setMessage(j.data.acknowledgement);
    } catch {
      setState('error');
      setMessage('Could not send that report. Please try again.');
    }
  }

  if (state === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="flex items-start gap-2 text-sm font-semibold text-emerald-900">
          <IconCheck width={16} height={16} className="mt-0.5 shrink-0" />
          {message}
        </p>
        <button type="button" className="fc-btn-secondary mt-3 !py-1.5 !text-xs" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-ink-200 bg-white p-4">
      <h3 className="text-sm font-bold">Report something wrong</h3>
      <p className="mt-0.5 text-xs text-ink-600">About {hospitalName}</p>

      <label className="mt-3 block">
        <span className="fc-label">What is wrong?</span>
        <select
          className="fc-input mt-1"
          value={fieldCode}
          onChange={(e) => setFieldCode(e.target.value)}
        >
          {CORRECTION_FIELDS.map((f) => (
            <option key={f} value={f}>{FIELD_LABELS[f] ?? f}</option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className="fc-label">How do you know?</span>
        <select
          className="fc-input mt-1"
          value={evidenceKind}
          onChange={(e) => setEvidenceKind(e.target.value)}
        >
          {EVIDENCE_KINDS.map((k) => (
            <option key={k.code} value={k.code}>{k.label}</option>
          ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className="fc-label">What is the correct detail? (optional)</span>
        <input
          className="fc-input mt-1"
          maxLength={300}
          value={claimedValue}
          onChange={(e) => setClaimedValue(e.target.value)}
          placeholder="e.g. the new number is 020 1234 5678"
        />
      </label>

      <label className="mt-3 block">
        <span className="fc-label">Anything else? (optional)</span>
        <textarea
          className="fc-input mt-1 min-h-[70px]"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. the OPD moved to the new block in August"
        />
      </label>

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-50 p-2.5 text-[11px] leading-relaxed text-ink-600">
        <IconInfo width={13} height={13} className="mt-0.5 shrink-0" />
        Please do not include health details. FlowCare stores facility
        information only. Your report goes to a person to check — it will not
        change what other people see until someone has confirmed it.
      </p>

      {state === 'error' && message && (
        <p role="alert" className="mt-2.5 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800">{message}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button type="submit" className="fc-btn-primary !py-2 !text-xs" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" className="fc-btn-secondary !py-2 !text-xs" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
