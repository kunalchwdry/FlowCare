/**
 * Skeleton loading system.
 *
 * One primitive (`Skeleton`) plus composites that mirror the real content
 * they stand in for, so the page does not jump when data arrives. Each
 * composite is wrapped in a live region marked `aria-busy`, and carries an
 * off-screen label, so a screen reader hears "Loading hospitals" instead of
 * a burst of meaningless empty boxes.
 *
 * The shimmer is CSS-only (see .fc-skeleton in globals.css) and is disabled
 * entirely under prefers-reduced-motion.
 */
import type { ReactNode } from 'react';

export function Skeleton({
  className = '',
  rounded = 'rounded-lg',
}: {
  className?: string;
  rounded?: string;
}) {
  return <span className={`fc-skeleton block ${rounded} ${className}`} />;
}

function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

export function HospitalCardSkeleton() {
  return (
    <div className="fc-card p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 shrink-0" rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="mt-2 h-3 w-2/5" />
        </div>
        <Skeleton className="h-8 w-8" rounded="rounded-lg" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-6 w-24" rounded="rounded-full" />
        <Skeleton className="h-6 w-28" rounded="rounded-full" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-20" rounded="rounded-full" />
        <Skeleton className="h-5 w-16" rounded="rounded-full" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-10 flex-1" rounded="rounded-xl" />
        <Skeleton className="h-10 flex-1" rounded="rounded-xl" />
      </div>
    </div>
  );
}

export function HospitalListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Loading label="Loading hospitals">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <HospitalCardSkeleton key={i} />
        ))}
      </div>
    </Loading>
  );
}

/* -------------------------------------------------------------- dashboard */

export function StatCardSkeleton() {
  return (
    <div className="fc-card p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-14" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <Loading label="Loading your dashboard">
      <div className="space-y-5">
        <div className="fc-card p-6">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-2.5 h-3.5 w-72" />
          <div className="mt-5 flex flex-wrap gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-36" rounded="rounded-xl" />
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <StatCardSkeleton key={i} />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="fc-card p-5 lg:col-span-2">
            <Skeleton className="h-4 w-40" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-ink-200 p-3">
                  <Skeleton className="h-9 w-9" rounded="rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="mt-2 h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-6 w-20" rounded="rounded-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="fc-card p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-24 w-full" rounded="rounded-xl" />
            <Skeleton className="mt-3 h-3 w-4/5" />
            <Skeleton className="mt-2 h-3 w-3/5" />
          </div>
        </div>
      </div>
    </Loading>
  );
}

/* ------------------------------------------------------- hospital details */

export function HospitalDetailSkeleton() {
  return (
    <Loading label="Loading hospital details">
      <div className="space-y-4">
        <div className="fc-card p-6">
          <div className="flex items-start gap-4">
            <Skeleton className="h-14 w-14 shrink-0" rounded="rounded-2xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-6 w-2/5" />
              <Skeleton className="mt-2.5 h-3.5 w-3/5" />
              <div className="mt-3 flex gap-2">
                <Skeleton className="h-6 w-28" rounded="rounded-full" />
                <Skeleton className="h-6 w-24" rounded="rounded-full" />
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <StatCardSkeleton key={i} />)}
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="fc-card p-5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/* ------------------------------------------------------------------ queue */

export function QueueSkeleton() {
  return (
    <Loading label="Loading queue position">
      <div className="fc-card p-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-16 w-28" rounded="rounded-2xl" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Skeleton className="h-14" rounded="rounded-xl" />
          <Skeleton className="h-14" rounded="rounded-xl" />
        </div>
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-6 w-6" rounded="rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

/* ------------------------------------------------------------------ table */

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <Loading label="Loading table">
      <div className="fc-card overflow-hidden">
        <div className="flex gap-4 border-b border-ink-200 bg-ink-50 px-4 py-3">
          {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="h-3 flex-1" />)}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 border-b border-ink-100 px-4 py-3.5 last:border-0">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={`h-3.5 flex-1 ${c === 0 ? '' : 'opacity-70'}`} />
            ))}
          </div>
        ))}
      </div>
    </Loading>
  );
}

/* --------------------------------------------------------------- generic */

export function SlotGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <Loading label="Loading available sessions">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="rounded-xl border border-ink-200 p-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-36" />
            <Skeleton className="mt-2 h-3 w-24" />
            <Skeleton className="mt-3 h-9 w-full" rounded="rounded-lg" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function TextBlockSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Loading label="Loading">
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
        ))}
      </div>
    </Loading>
  );
}
