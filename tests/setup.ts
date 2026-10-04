/**
 * Vitest global setup.
 *
 * Tests run WITHOUT any real credentials. We deliberately do not set
 * SUPABASE_*, GOOGLE_MAPS_API_KEY or any AI provider key here, so the suite
 * exercises exactly the "not configured" degradation paths that a fresh
 * checkout hits. Individual tests that need a configured provider stub the
 * provider object directly rather than injecting a fake key.
 */
process.env.FLOWCARE_DEMO_MODE = 'true';
process.env.TZ = 'Asia/Kolkata';

// The demo repository is intentionally file-backed for a running app. Tests
// need a clean baseline so an earlier run cannot turn an appointment request
// into a confirmed appointment before a tampering assertion starts.
import fs from 'node:fs';
import path from 'node:path';
fs.rmSync(path.join(process.cwd(), '.data', 'demo-state.json'), { force: true });

import { afterEach } from 'vitest';
import { __resetRateLimits } from '../src/lib/ratelimit';
import { __resetAnalytics } from '../src/lib/analytics';

afterEach(() => {
  __resetRateLimits();
  __resetAnalytics();
});

type Review = import('../src/lib/types').HospitalReview;

/**
 * Builds a HospitalReview without repeating boilerplate in every test.
 * `over` is intentionally loose so a test can inject a shape the TYPE forbids
 * (e.g. verifiedVisit: false) to prove the runtime guard still holds.
 */
export function makeReview(over: Partial<Review> | Record<string, unknown> = {}): Review {
  return {
    id: `rev-${Math.random().toString(36).slice(2, 9)}`,
    hospitalId: 'h1',
    authorId: 'user-1',
    authorHandle: 'Verified patient · A.B.',
    appointmentId: 'appt-1',
    ratings: { overall: 4, waiting: 4, staff: 4, appointment: 4, facility: 4 },
    comment: null,
    createdAt: new Date().toISOString(),
    status: 'published' as const,
    verifiedVisit: true,
    helpfulCount: 0,
    ...over,
  } as Review;
}

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
