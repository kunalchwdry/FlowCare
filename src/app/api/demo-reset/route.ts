import { getRepo } from '@/lib/data';
import { isDemoMode } from '@/lib/env';
import { requireRole } from '@/lib/auth/session';
import { fail, handleError, ok } from '@/lib/http';
import { __resetDemoState } from '@/lib/data/demoRepo';
import { __resetRateLimits } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Clears mutable demo state (favourites, reviews, corrections, care contexts,
 * visits, reminders) back to the seed.
 *
 * WHY THIS EXISTS: the demo repository persists to .data/demo-state.json so
 * that work survives a dev-server restart. That is the right behaviour for a
 * person clicking around, and the wrong behaviour for a test suite — the
 * F17 daily correction cap is a real control, and without a reset the HTTP
 * tests trip it on their second run and report a false failure.
 *
 * It also clears the in-process rate-limit buckets. Limits like the F17
 * per-minute correction cap are counted BEFORE validation (deliberately — a
 * flood of malformed requests is still a flood), so a test file that
 * exercises rejection paths burns through the same budget as one that
 * exercises success paths, and later assertions get 429s they did not ask
 * for.
 *
 * SAFETY: this route does not exist outside demo mode. `isDemoMode()` is
 * false whenever Supabase is configured and FLOWCARE_DEMO_MODE is not
 * forced, and the handler 404s before touching anything. It additionally
 * requires an admin session, so it is not reachable by an anonymous caller
 * even in a demo deployment.
 */
export async function POST() {
  try {
    if (!isDemoMode()) return fail(404, 'Not found');

    const user = await requireRole('admin');
    __resetDemoState();
    __resetRateLimits();

    const repo = await getRepo();
    await repo.recordAuditEvent({
      actorId: user.id, actorRole: user.role, action: 'demo.reset',
      entity: 'demo_state', entityId: null, metadata: {},
    });

    return ok({ reset: true });
  } catch (e) {
    return handleError(e);
  }
}
