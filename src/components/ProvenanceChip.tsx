'use client';

/**
 * F18 — the per-field provenance chip.
 *
 * This is the smallest component in the product and the one the whole
 * journey layer rests on. Every fact a patient reads is rendered next to one
 * of these, because the alternative — a single "verified hospital" badge at
 * the top of the page — is the exact lie P24 describes: it implies the phone
 * number checked in March is as trustworthy as the ramp checked last week.
 *
 * Four states, four visual treatments, no score.
 */
import { IconCheck, IconClock, IconInfo } from './Icons';
import { freshnessOf, type FactField } from '@/lib/provenance';
import type { FreshnessState, FreshnessView, Provenance } from '@/lib/types';

const STYLES: Record<FreshnessState, string> = {
  fresh: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  live: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
  ageing: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  stale: 'bg-rose-50 text-rose-800 ring-1 ring-rose-200',
  unverified: 'bg-ink-100 text-ink-600 ring-1 ring-ink-200',
};

function Glyph({ state }: { state: FreshnessState }) {
  if (state === 'fresh') return <IconCheck width={12} height={12} />;
  if (state === 'unverified') return <IconInfo width={12} height={12} />;
  return <IconClock width={12} height={12} />;
}

export function ProvenanceChip({
  freshness,
  className = '',
}: {
  freshness: FreshnessView;
  className?: string;
}) {
  return (
    <span
      className={`fc-pill !px-2 !py-0.5 !text-[10.5px] ${STYLES[freshness.state]} ${className}`}
      title={
        freshness.caution
          ? `${freshness.label} — ${freshness.caution}`
          : `${freshness.label}. "Verified" means a person checked on this date. It is not a guarantee.`
      }
    >
      <Glyph state={freshness.state} />
      <span className="font-semibold">{freshness.label}</span>
      {freshness.caution && <span className="font-normal opacity-80">· {freshness.caution}</span>}
    </span>
  );
}

/** Convenience wrapper when you hold raw provenance rather than a computed view. */
export function ProvenanceChipFor({
  provenance,
  field,
  className,
}: {
  provenance: Provenance;
  field: FactField;
  className?: string;
}) {
  return <ProvenanceChip freshness={freshnessOf(provenance, field)} className={className} />;
}

/** Plain-language chip used where a FreshnessView is not available. */
export function StaticChip({ text, tone = 'unverified' }: { text: string; tone?: FreshnessState }) {
  return (
    <span className={`fc-pill !px-2 !py-0.5 !text-[10.5px] ${STYLES[tone]}`}>
      <Glyph state={tone} />
      {text}
    </span>
  );
}

/**
 * Facility-level freshness summary. Renders COUNTS, never a composite score
 * or grade — see the doctrine note in lib/provenance.ts.
 */
export function FreshnessSummaryBar({
  summary,
}: {
  summary: { total: number; fresh: number; ageing: number; stale: number; unverified: number; medianAgeDays: number | null };
}) {
  if (!summary.total) return null;
  const parts = [
    { n: summary.fresh, label: 'recently checked', cls: 'bg-emerald-500' },
    { n: summary.ageing, label: 'checked a while ago', cls: 'bg-amber-500' },
    { n: summary.stale, label: 'may be out of date', cls: 'bg-rose-500' },
    { n: summary.unverified, label: 'never checked', cls: 'bg-ink-300' },
  ].filter((p) => p.n > 0);

  return (
    <div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        {parts.map((p) => (
          <div
            key={p.label}
            className={p.cls}
            style={{ width: `${(p.n / summary.total) * 100}%` }}
            title={`${p.n} ${p.label}`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">
        {summary.total} facts on this page.{' '}
        {parts.map((p, i) => (
          <span key={p.label}>
            {i > 0 && ', '}
            <span className="font-semibold text-ink-800">{p.n}</span> {p.label}
          </span>
        ))}
        {summary.medianAgeDays !== null && (
          <> · median age {Math.round(summary.medianAgeDays)} days.</>
        )}
      </p>
    </div>
  );
}
