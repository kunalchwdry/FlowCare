/**
 * Hospital-portal authorisation.
 *
 * One rule underpins all of it: a member of staff is a member of *one*
 * hospital, and everything they can see is scoped by that hospital's id.
 * There is deliberately no global administrator — not a role that is merely
 * unused, but no code path that can produce one. `hospitalId` comes from the
 * caller's own membership row and is never read from a query string, a body,
 * or a header.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession, type SessionUser } from '@/lib/auth/session';

export const HOSPITAL_PERMISSIONS = [
  'appointments:read',
  'appointments:manage',
  'queue:read',
  'queue:manage',
  'memberships:manage',
  'reviews:moderate',
  'facts:manage',
  'corrections:review',
  'structure:manage',
  'slots:manage',
  'exports:read',
] as const;
export type HospitalPermission = (typeof HOSPITAL_PERMISSIONS)[number];

export const PERMISSION_LABEL: Record<HospitalPermission, string> = {
  'appointments:read': 'View appointments',
  'appointments:manage': 'Accept, decline and reschedule appointments',
  'queue:read': 'View today’s queue',
  'queue:manage': 'Move patients through the queue',
  'memberships:manage': 'Manage staff and their permissions',
  'reviews:moderate': 'Moderate reviews',
  'facts:manage': 'Maintain hospital information',
  'corrections:review': 'Review submitted corrections',
  'structure:manage': 'Manage departments and providers',
  'slots:manage': 'Manage slot supply and capacity',
  'exports:read': 'Export minimum-necessary operational data',
};

/**
 * Convenience presets. These are a UI affordance only — nothing reads the
 * preset name at authorisation time, because the stored permission array is
 * the sole source of truth. A preset is a shortcut for filling that array in,
 * not a role that confers anything by itself.
 */
export const ROLE_PRESETS: { id: string; label: string; description: string; permissions: HospitalPermission[] }[] = [
  {
    id: 'reception',
    label: 'Reception',
    description: 'Handles requests and the day’s queue.',
    permissions: ['appointments:read', 'appointments:manage', 'queue:read', 'queue:manage'],
  },
  {
    id: 'information',
    label: 'Information manager',
    description: 'Keeps the hospital’s published facts accurate.',
    permissions: ['facts:manage', 'corrections:review'],
  },
  {
    id: 'reviews',
    label: 'Review manager',
    description: 'Moderates patient reviews.',
    permissions: ['reviews:moderate'],
  },
  {
    id: 'manager',
    label: 'Hospital manager',
    description: 'Everything above, including staff management.',
    permissions: [...HOSPITAL_PERMISSIONS],
  },
];

export interface HospitalActor {
  user: SessionUser;
  hospitalId: string;
  permissions: HospitalPermission[];
}

/** Three outcomes, not two — see requireHospital. */
export type HospitalGate =
  | { kind: 'ok'; actor: HospitalActor }
  | { kind: 'no-membership'; user: SessionUser };

function permissionsFor(user: SessionUser): HospitalPermission[] {
  // The session resolver maps an active membership's permission array onto
  // the role. 'admin' means the row carried memberships:manage.
  if (user.role === 'admin') return [...HOSPITAL_PERMISSIONS];
  if (user.role === 'staff') {
    return ['appointments:read', 'appointments:manage', 'queue:read', 'queue:manage'];
  }
  return [];
}

/**
 * Resolve the caller as hospital staff.
 *
 * Signed out redirects. Signed in *without* a membership does not redirect:
 * that person has an account and is waiting for approval, and bouncing them
 * to a login page they already passed tells them nothing. They get a page
 * explaining where their request stands.
 */
/**
 * Strip the /hospital prefix when the request arrived on a hospital
 * hostname.
 *
 * On hospital.example.com the prefix is an implementation detail of the
 * middleware rewrite. Leaving it in a redirect produces
 * hospital.example.com/hospital/login, which looks like a bug and breaks
 * the illusion that this is simply the hospital's own site.
 */
async function publicPath(path: string): Promise<string> {
  const host = (await headers()).get('host')?.split(':')[0].toLowerCase() ?? '';
  const configured = (process.env.HOSPITAL_HOSTS ?? '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const onHospitalHost =
    configured.includes(host) || host.startsWith('hospital.') || host.startsWith('staff.');
  if (!onHospitalHost || !path.startsWith('/hospital')) return path;
  return path.slice('/hospital'.length) || '/';
}

export async function requireHospital(next = '/hospital'): Promise<HospitalGate> {
  const user = await getSession();
  if (!user) {
    const door = await publicPath('/hospital/login');
    redirect(`${door}?next=${encodeURIComponent(await publicPath(next))}`);
  }
  if (user.role !== 'staff' && user.role !== 'admin') {
    return { kind: 'no-membership', user };
  }
  if (!user.hospitalId) return { kind: 'no-membership', user };
  return {
    kind: 'ok',
    actor: { user, hospitalId: user.hospitalId, permissions: permissionsFor(user) },
  };
}

/**
 * As above, but the page also demands a specific permission.
 *
 * Returning 'no-membership' rather than throwing keeps the portal navigable:
 * staff who lack one permission still see the rest of the portal and are told
 * plainly which permission the page needs.
 */
export async function requireHospitalPermission(
  permission: HospitalPermission,
  next = '/hospital',
): Promise<HospitalGate | { kind: 'forbidden'; actor: HospitalActor; needs: HospitalPermission }> {
  const gate = await requireHospital(next);
  if (gate.kind !== 'ok') return gate;
  if (!gate.actor.permissions.includes(permission)) {
    return { kind: 'forbidden', actor: gate.actor, needs: permission };
  }
  return gate;
}

export function can(actor: HospitalActor | null, permission: HospitalPermission): boolean {
  return Boolean(actor?.permissions.includes(permission));
}

/**
 * Guard for API routes.
 *
 * Returns the actor or a reason code. Callers answer a cross-hospital
 * reference with 404 rather than 403 — a 403 confirms the id exists, which
 * is enough to enumerate another hospital's appointments.
 */
export async function hospitalActorFromSession(): Promise<HospitalActor | null> {
  const user = await getSession();
  if (!user || (user.role !== 'staff' && user.role !== 'admin') || !user.hospitalId) return null;
  return { user, hospitalId: user.hospitalId, permissions: permissionsFor(user) };
}
