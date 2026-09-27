import { redirect } from 'next/navigation';
import { getSession, type SessionUser } from '@/lib/auth/session';
import { findByEmail } from '@/lib/staff/accessRequests';

/**
 * Page-level guards.
 *
 * These exist for user experience — sending someone to the right sign-in
 * door instead of showing them an empty screen. They are **not** the
 * security boundary. Every route handler re-checks the session, and the
 * database enforces row-level policies underneath that. Hiding a link has
 * never stopped anybody.
 */

export async function requirePatientPage(next = '/patient'): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect(`/patient/login?next=${encodeURIComponent(next)}`);
  return session;
}

export type StaffGate =
  | { state: 'ok'; user: SessionUser }
  | { state: 'pending'; user: SessionUser; hospitalName: string; requestedRole: string }
  | { state: 'none'; user: SessionUser };

/**
 * Staff pages have three outcomes, not two: signed out, signed in but not
 * yet approved, and approved. The middle case is the one that matters — a
 * person who has registered deserves to be told where their request stands,
 * not bounced to a login page they have already passed.
 */
export async function requireStaffPage(next = '/staff'): Promise<StaffGate> {
  const session = await getSession();
  if (!session) redirect(`/staff/login?next=${encodeURIComponent(next)}`);

  if (session.role === 'staff' || session.role === 'admin') {
    return { state: 'ok', user: session };
  }

  const request = session.email ? await findByEmail(session.email) : null;
  if (request && request.status === 'pending') {
    return {
      state: 'pending',
      user: session,
      hospitalName: request.hospitalName,
      requestedRole: request.requestedRole,
    };
  }
  return { state: 'none', user: session };
}

/** True only for an approved administrator bound to a hospital. */
export function isHospitalAdmin(user: SessionUser): boolean {
  return user.role === 'admin' && Boolean(user.hospitalId);
}
