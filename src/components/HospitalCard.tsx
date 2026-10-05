'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AvailabilityPill, DemoBadge, FlowCareRating, GoogleRating, VerifiedBadge } from './Badges';
import { IconChevron, IconCompare, IconHeart, IconInfo, IconPin } from './Icons';
import { formatDistance } from '@/lib/discovery/geo';
import { label } from '@/lib/discovery/filters';
import type { DiscoveryResult } from '@/lib/types';
import { TrafficSummary } from './PatientTraffic';

export interface EvidenceItem { kind: 'flowcare' | 'google' | 'geo'; text: string }
export type ResultWithEvidence = DiscoveryResult & { evidence?: EvidenceItem[] };

export function HospitalCard({
  result, onToggleCompare, inCompare, onToggleFavorite, isFavorite, compact = false,
}: {
  result: ResultWithEvidence;
  onToggleCompare?: (id: string) => void;
  inCompare?: boolean;
  onToggleFavorite?: (id: string) => void;
  isFavorite?: boolean;
  compact?: boolean;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const h = result.hospital;
  const depts = h.departments.filter((d) => d.active);

  return (
    <article className="fc-card overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {h.flowcareVerified && <VerifiedBadge />}
              {h.isDemoRecord && <DemoBadge />}
            </div>
            <h3 className="mt-1.5 text-[15px] font-bold leading-snug text-ink-900">
              <Link href={`/hospitals/${h.slug}`} className="hover:text-brand-700">{h.name}</Link>
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
              <IconPin width={13} height={13} />
              {h.addressLine}
              {result.distanceKm !== null && <span className="font-medium text-ink-700">· {formatDistance(result.distanceKm)}</span>}
            </p>
          </div>

          <div className="flex shrink-0 gap-1">
            {onToggleFavorite && (
              <button
                type="button"
                aria-pressed={isFavorite}
                aria-label={isFavorite ? `Remove ${h.name} from saved` : `Save ${h.name}`}
                onClick={() => onToggleFavorite(h.id)}
                className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors ${
                  isFavorite ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-ink-200 text-ink-400 hover:bg-ink-50'
                }`}
              >
                <IconHeart width={17} height={17} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
            )}
            {onToggleCompare && (
              <button
                type="button"
                aria-pressed={inCompare}
                aria-label={inCompare ? `Remove ${h.name} from comparison` : `Add ${h.name} to comparison`}
                onClick={() => onToggleCompare(h.id)}
                className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors ${
                  inCompare ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-400 hover:bg-ink-50'
                }`}
              >
                <IconCompare width={17} height={17} />
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <AvailabilityPill
            state={result.availability.state}
            nextDate={result.availability.nextAvailableDate}
            computedAt={result.availability.computedAt}
          />
          <FlowCareRating summary={result.flowcareRating} />
          <GoogleRating
            rating={result.external.data?.rating}
            count={result.external.data?.userRatingCount}
            uri={result.external.data?.googleMapsUri}
          />
        </div>

        <TrafficSummary traffic={result.traffic} />

        {!compact && (
          <div className="mt-3 flex flex-wrap gap-1">
            {depts.slice(0, 5).map((d) => (
              <span key={d.id} className="rounded-lg bg-ink-100 px-2 py-1 text-[11px] font-medium text-ink-700">
                {d.name}
              </span>
            ))}
            {depts.length > 5 && (
              <span className="rounded-lg bg-ink-100 px-2 py-1 text-[11px] font-medium text-ink-500">
                +{depts.length - 5} more
              </span>
            )}
          </div>
        )}

        {result.match?.displayable && (
          <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-brand-800">{result.match.percent}% preference match</span>
              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold text-brand-700 underline"
                aria-expanded={showWhy}
              >
                <IconInfo width={12} height={12} /> {showWhy ? 'Hide' : 'Why this appeared'}
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-brand-900/80">{result.match.summary}</p>
            {showWhy && (
              <div className="mt-2 space-y-1.5 border-t border-brand-200 pt-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-brand-700">
                  Evidence (from FlowCare and Google data, not generated text)
                </p>
                {(result.evidence ?? []).map((e, i) => (
                  <p key={i} className="flex gap-1.5 text-[11px] text-ink-700">
                    <span className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                      e.kind === 'google' ? 'bg-ink-400' : e.kind === 'geo' ? 'bg-violet-400' : 'bg-brand-500'
                    }`} />
                    {e.text}
                  </p>
                ))}
                <details className="pt-1">
                  <summary className="cursor-pointer text-[11px] font-semibold text-brand-700">
                    How the {result.match.percent}% is calculated ({result.match.methodVersion})
                  </summary>
                  <table className="mt-1.5 w-full text-[10.5px]">
                    <thead className="text-ink-500">
                      <tr><th className="text-left font-semibold">Criterion</th><th className="text-right font-semibold">Weight</th><th className="text-right font-semibold">Score</th></tr>
                    </thead>
                    <tbody>
                      {result.match.criteria.map((c) => (
                        <tr key={c.criterion} className="border-t border-brand-100">
                          <td className="py-1 pr-2 text-ink-700">{c.label}<br /><span className="text-ink-400">{c.evidence}</span></td>
                          <td className="py-1 text-right align-top text-ink-600">{c.weight.toFixed(0)}</td>
                          <td className="py-1 text-right align-top text-ink-600">{(c.score * 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-ink-100 bg-ink-50/50 px-4 py-2.5">
        <Link href={`/hospitals/${h.slug}`} className="fc-btn-secondary !min-h-[40px] flex-1 !py-2 text-xs">
          View hospital <IconChevron width={14} height={14} />
        </Link>
        <Link
          href={`/appointments/new?hospital=${h.slug}`}
          className={`fc-btn-primary !min-h-[40px] flex-1 !py-2 text-xs ${
            result.availability.state === 'none' ? 'pointer-events-none opacity-40' : ''
          }`}
          aria-disabled={result.availability.state === 'none'}
        >
          Book appointment
        </Link>
      </div>
    </article>
  );
}

export function HospitalCardSkeleton() {
  return (
    <div className="fc-card p-4">
      <div className="fc-skeleton h-4 w-24" />
      <div className="fc-skeleton mt-3 h-5 w-3/4" />
      <div className="fc-skeleton mt-2 h-3 w-1/2" />
      <div className="mt-4 flex gap-2">
        <div className="fc-skeleton h-6 w-32" />
        <div className="fc-skeleton h-6 w-28" />
      </div>
      <div className="fc-skeleton mt-4 h-9 w-full" />
    </div>
  );
}

export { label };
