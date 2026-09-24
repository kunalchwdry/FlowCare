/**
 * Journey-layer limits and retention windows.
 *
 * These live in lib/ rather than beside the route handlers that enforce
 * them: a Next.js route file may only export HTTP verb handlers (plus the
 * framework's own config exports), so any shared constant declared there
 * breaks `next build` even though `tsc --noEmit` is happy.
 */

/** F3 — how many care contexts one account may hold. */
export const MAX_CARE_CONTEXTS = 6;

/** F19 — visit records are hard-deleted after this long. */
export const VISIT_RETENTION_MONTHS = 24;

/** F19 — cutoff timestamp for the retention sweep. */
export function visitRetentionCutoff(now: Date = new Date()): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - VISIT_RETENTION_MONTHS);
  return d.toISOString();
}
