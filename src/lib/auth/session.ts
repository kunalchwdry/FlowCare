import { cookies } from 'next/headers';
import { isDemoMode } from '@/lib/env';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { DEMO_USERS } from '@/lib/data/seed';

export type Role = 'patient' | 'staff' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Set for staff/admin bound to a specific hospital. */
  hospitalId: string | null;
  source: 'supabase' | 'demo';
}

export const DEMO_COOKIE = 'fc_demo_user';

/**
 * Resolves the caller. With Supabase configured this reads the verified JWT
 * user (the existing FlowCare auth), otherwise it falls back to a clearly
 * labelled demo-account cookie used only when NEXT_PUBLIC_SUPABASE_URL is
 * absent. The demo path is never active in a Supabase-configured deployment.
 */
export async function getSession(): Promise<SessionUser | null> {
  if (!isDemoMode()) {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
    let role: Role = (meta.role as Role) ?? 'patient';
    let hospitalId: string | null = (meta.hospital_id as string) ?? null;

    /**
     * Staff standing comes from the memberships table, not from app_metadata.
     *
     * app_metadata is only writable with the service-role key, which this
     * deployment does not hold, so relying on it meant no account could ever
     * be anything but a patient — the approval screen granted a role that
     * nothing could read back.
     *
     * memberships already carries status, an approved_by trail, a version for
     * optimistic concurrency, and a permissions allowlist. Its RLS policy is
     * `user_id = private.actor() OR private.allowed(hospital_id,
     * 'memberships:manage')`, so this query returns the caller's own row and
     * nothing else even though it runs on the ordinary authenticated client.
     * The database decides; we are only reading the verdict.
     *
     * Only an active membership counts. 'pending' is a submitted request and
     * must not confer anything, which is what keeps approval meaningful.
     */
    const { data: membership } = await supabase
      .from('memberships')
      .select('hospital_id, permissions')
      .eq('user_id', data.user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (membership) {
      hospitalId = membership.hospital_id as string;
      const perms = (membership.permissions as string[] | null) ?? [];
      // The permission to manage other people's membership is what separates
      // an administrator from a member of staff. Nothing else is tested here,
      // because every endpoint re-checks the specific permission it needs.
      role = perms.includes('memberships:manage') ? 'admin' : 'staff';
    }

    return {
      id: data.user.id,
      email: data.user.email ?? '',
      name: (data.user.user_metadata?.full_name as string) ?? data.user.email ?? 'Patient',
      role,
      hospitalId,
      source: 'supabase',
    };
  }

  const store = await cookies();
  const key = store.get(DEMO_COOKIE)?.value as keyof typeof DEMO_USERS | undefined;
  if (!key || !(key in DEMO_USERS)) return null;
  const u = DEMO_USERS[key];
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    hospitalId: demoHospitalFor(u.role, 'hospitalId' in u ? (u.hospitalId as string) : null),
    source: 'demo',
  };
}

/**
 * Which hospital a demo staff or admin account is bound to.
 *
 * The seeded demo hospital slugs only exist in the bundled demo dataset.
 * When the app is pointed at a real database (live-read mode) those slugs
 * resolve to nothing, and a staff dashboard full of zeroes looks like a bug
 * rather than a configuration gap. FLOWCARE_DEMO_HOSPITAL_ID lets a
 * deployment bind the demo staff accounts to a hospital that actually
 * exists there.
 *
 * This affects demo accounts only. A real Supabase session takes its
 * hospital from app_metadata, which no user can write.
 */
function demoHospitalFor(role: Role, seeded: string | null): string | null {
  if (role !== 'staff' && role !== 'admin') return null;
  const override = process.env.FLOWCARE_DEMO_HOSPITAL_ID?.trim();
  if (override) return override;
  return seeded;
}

export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Sign in to continue');
  return s;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const s = await requireUser();
  if (!roles.includes(s.role)) throw new HttpError(403, 'You do not have access to this action');
  return s;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Public display handle — never leaks full name or email. */
export function publicHandle(user: SessionUser): string {
  const parts = user.name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).filter(Boolean).join('.');
  return `Verified patient · ${initials || 'A'}.`;
}
