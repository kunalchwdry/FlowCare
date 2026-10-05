import type { VerifiedVisit } from '@/lib/reliability/types';
import { formatDate } from '@/lib/time';
import { IconCalendar } from '@/components/Icons';

export function VerifiedVisitHistory({ visits, hospitalView = false, error = false }: { visits: VerifiedVisit[]; hospitalView?: boolean; error?: boolean }) {
  return (
    <section className="fc-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="fc-eyebrow">FlowCare record</p>
          <h2 className="mt-1 fc-h2">{hospitalView ? 'Recent completed visits' : 'Verified visit history'}</h2>
        </div>
        <span className="text-[11px] text-ink-500">{visits.length} shown</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-500">
        {hospitalView
          ? 'A limited, privacy-safe summary of completed FlowCare visits. Clinical notes and documents are not included.'
          : 'Only completed FlowCare appointments appear here. This is separate from personal visit notes you may enter yourself.'}
      </p>
      {error ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs leading-relaxed text-rose-800">
          We could not load verified visits from FlowCare. No empty result is being substituted for the failed read.
        </p>
      ) : visits.length ? (
        <ul className="mt-4 space-y-2">
          {visits.map((visit) => (
            <li key={visit.appointmentId} className="flex items-center gap-3 rounded-xl border border-ink-200 p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <IconCalendar width={16} height={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-900">{visit.hospitalName ?? 'FlowCare hospital'}</span>
                <span className="block truncate text-xs text-ink-500">
                  {formatDate(visit.visitDate)}{visit.departmentName ? ` · ${visit.departmentName}` : ''}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{visit.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl bg-ink-50 p-4 text-xs leading-relaxed text-ink-600">
          No completed FlowCare visits are available yet. A visit appears after the hospital records the official completion transition.
        </p>
      )}
    </section>
  );
}
