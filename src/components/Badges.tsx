'use client';

import { IconAccessible, IconCheck, IconClock, IconInfo, IconStar } from './Icons';
import type { AvailabilityState, FlowCareRatingSummary } from '@/lib/types';

const AVAIL: Record<AvailabilityState, { text: string; cls: string }> = {
  available: { text: 'Appointments available', cls: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' },
  limited: { text: 'Limited availability', cls: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
  none: { text: 'No current availability', cls: 'bg-rose-50 text-rose-800 ring-1 ring-rose-200' },
  unknown: { text: 'Availability unknown', cls: 'bg-ink-100 text-ink-600 ring-1 ring-ink-200' },
};

export function AvailabilityPill({
  state, nextDate, computedAt, compact = false,
}: { state: AvailabilityState; nextDate?: string | null; computedAt?: string; compact?: boolean }) {
  const a = AVAIL[state];
  return (
    <span className={`fc-pill ${a.cls}`} title={computedAt ? `FlowCare session data checked ${new Date(computedAt).toLocaleString()}` : undefined}>
      <IconClock width={13} height={13} />
      {a.text}
      {!compact && nextDate && state !== 'none' && state !== 'unknown' && (
        <span className="font-normal opacity-80">· from {nextDate}</span>
      )}
    </span>
  );
}

/**
 * The two ratings are ALWAYS rendered as separate, differently-styled objects.
 * FlowCare's is badged "verified visits"; Google's is badged and attributed.
 */
export function FlowCareRating({ summary, showMethod = false }: { summary: FlowCareRatingSummary; showMethod?: boolean }) {
  if (summary.score === null) {
    return (
      <span className="fc-pill bg-ink-100 text-ink-600 ring-1 ring-ink-200" title={summary.insufficientReason ?? ''}>
        <IconInfo width={13} height={13} />
        {summary.reviewCount === 0 ? 'No FlowCare reviews yet' : `Not enough FlowCare reviews yet (${summary.reviewCount})`}
      </span>
    );
  }
  return (
    <span className="fc-pill bg-brand-50 text-brand-800 ring-1 ring-brand-200">
      <IconStar width={13} height={13} />
      {summary.score.toFixed(1)} FlowCare
      <span className="font-normal opacity-80">· {summary.reviewCount} verified visits</span>
      {showMethod && summary.confidenceLow !== null && (
        <span className="font-normal opacity-70">({summary.confidenceLow.toFixed(1)}–{summary.confidenceHigh?.toFixed(1)})</span>
      )}
    </span>
  );
}

export function GoogleRating({
  rating, count, uri,
}: { rating?: number; count?: number; uri?: string | null }) {
  if (rating === undefined) return null;
  const inner = (
    <>
      <IconStar width={13} height={13} />
      {rating.toFixed(1)} Google
      <span className="font-normal opacity-80">· {count ?? 0} ratings</span>
    </>
  );
  const cls = 'fc-pill bg-ink-100 text-ink-700 ring-1 ring-ink-200';
  return uri ? (
    <a href={uri} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-ink-200`} title="Open on Google Maps — rating provided by Google, not verified by FlowCare">
      {inner}
    </a>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export function VerifiedBadge({ text = 'FlowCare verified' }: { text?: string }) {
  return (
    <span className="fc-pill bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">
      <IconCheck width={13} height={13} /> {text}
    </span>
  );
}

export function DemoBadge() {
  return <span className="fc-pill bg-amber-100 text-amber-900 ring-1 ring-amber-200">Demo record</span>;
}

export function AccessibilityBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="fc-pill bg-violet-50 text-violet-800 ring-1 ring-violet-200">
      <IconAccessible width={13} height={13} /> {count} accessibility feature{count > 1 ? 's' : ''}
    </span>
  );
}

export function SourceTag({ source }: { source: 'flowcare' | 'google' }) {
  return source === 'flowcare' ? (
    <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
      FlowCare verified
    </span>
  ) : (
    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-600">
      From Google Maps
    </span>
  );
}
