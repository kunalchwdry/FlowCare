import type { PatientReliability, ReliabilityEvent } from '@/lib/reliability/types';
import { reliabilityStatusLabel } from '@/lib/reliability/types';
import { formatDate } from '@/lib/time';

const tone: Record<PatientReliability['status'], string> = {
  excellent: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  good: 'border-brand-200 bg-brand-50 text-brand-800',
  needs_improvement: 'border-amber-200 bg-amber-50 text-amber-900',
  poor: 'border-rose-200 bg-rose-50 text-rose-800',
};

function eventCopy(event: ReliabilityEvent): string {
  if (event.type === 'attended') return 'Completed appointment';
  if (event.type === 'late_cancellation') return 'Late cancellation';
  return 'Official no-show recorded';
}

export function ReliabilityErrorCard() {
  return (
    <section className="fc-card border-rose-200 bg-rose-50/60 p-5">
      <p className="fc-eyebrow text-rose-700">FlowCare reliability</p>
      <h2 className="mt-1 fc-h2">Unable to load reliability</h2>
      <p className="mt-2 text-xs leading-relaxed text-rose-800">
        The score and attendance data could not be read from FlowCare right now. No replacement score or fabricated history is being shown.
      </p>
    </section>
  );
}

export function ReliabilityCard({ reliability, showHistory = true }: { reliability: PatientReliability; showHistory?: boolean }) {
  return (
    <section className="fc-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="fc-eyebrow">FlowCare reliability</p>
          <h2 className="mt-1 fc-h2">Credit points</h2>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone[reliability.status]}`}>
          {reliabilityStatusLabel(reliability.status)}
        </span>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <span className="text-4xl font-extrabold tracking-tight text-ink-900">{reliability.score}</span>
        <span className="mb-1.5 text-sm font-semibold text-ink-500">/ 100 points</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-600">
        Starts at 100. Points use only official FlowCare appointment outcomes — completed visits,
        recorded late cancellations and official no-show transitions. Nobody can edit this from a portal.
      </p>

      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-ink-500">Attendance</p>
      <div className="mt-2 grid grid-cols-2 gap-2 border-y border-ink-100 py-3 text-center sm:grid-cols-4">
        <div><p className="text-lg font-bold text-ink-900">{reliability.completedCount}</p><p className="text-[10px] text-ink-500">completed</p></div>
        <div><p className="text-lg font-bold text-ink-900">{reliability.cancelledCount}</p><p className="text-[10px] text-ink-500">cancelled</p></div>
        <div><p className="text-lg font-bold text-ink-900">{reliability.lateCancellationCount}</p><p className="text-[10px] text-ink-500">late cancels</p></div>
        <div><p className="text-lg font-bold text-ink-900">{reliability.noShowCount}</p><p className="text-[10px] text-ink-500">no-shows</p></div>
      </div>

      {showHistory && (
        <div className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500">Point history</h3>
          {reliability.pointHistory.length ? (
            <ul className="mt-2 space-y-2">
              {reliability.pointHistory.slice(0, 8).map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-ink-700">{eventCopy(event)}</span>
                  <span className="shrink-0 font-bold tabular-nums text-ink-700">
                    {event.pointsDelta > 0 ? '+' : ''}{event.pointsDelta} · {formatDate(event.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-500">No point changes yet. Your starting score is shown above.</p>
          )}
        </div>
      )}
    </section>
  );
}
