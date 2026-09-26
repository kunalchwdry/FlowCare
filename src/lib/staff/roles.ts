/**
 * Staff role vocabulary and the shape of an access request.
 *
 * Kept free of any Node import on purpose: both the browser (forms, the
 * approval list) and the server (storage, the API) need these names, and a
 * single `node:fs` import in here would drag the filesystem into the client
 * bundle.
 */

export const STAFF_ROLES = ['hospital_admin', 'doctor', 'receptionist', 'nurse', 'staff'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  hospital_admin: 'Hospital Administrator',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  nurse: 'Nurse',
  staff: 'Staff',
};

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface StaffAccessRequest {
  id: string;
  email: string;
  fullName: string;
  hospitalId: string;
  hospitalName: string;
  /** What the applicant *asked* for. Never what they were granted. */
  requestedRole: StaffRole;
  staffId: string | null;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}
