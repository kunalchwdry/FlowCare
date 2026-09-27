import Link from 'next/link';
import type { Metadata } from 'next';
import { requireStaffPage, isHospitalAdmin } from '@/lib/auth/guards';
import { listRequests } from '@/lib/staff/accessRequests';
import { getRepo } from '@/lib/data';
import { AccessRequestList } from '@/components/staff/AccessRequestList';
import { ErrorState } from '@/components/States';

export const metadata: Metadata = { title: 'Staff & access — FlowCare' };
export const dynamic = 'force-dynamic';

export default async function StaffTeamPage() {
  const gate = await requireStaffPage('/staff/team');

  // Anyone who is not an approved administrator gets the same answer, and it
  // is the page that decides — the API behind it checks independently.
  if (gate.state !== 'ok' || !isHospitalAdmin(gate.user)) {
    return (
      <div className="py-8">
        <ErrorState
          kind="forbidden"
          primary={{ label: 'Back to the staff dashboard', href: '/staff' }}
        />
      </div>
    );
  }

  const repo = await getRepo();
  const [hospital, requests] = await Promise.all([
    gate.user.hospitalId ? repo.getHospital(gate.user.hospitalId) : Promise.resolve(null),
    listRequests({ hospitalId: gate.user.hospitalId! }),
  ]);

  return (
    <div className="space-y-5 py-2">
      <header className="fc-card p-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
          <Link href="/staff" className="hover:underline">Staff dashboard</Link>
          <span aria-hidden="true"> / </span>
          <span className="font-semibold text-ink-700">Staff &amp; access</span>
        </nav>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900">Staff &amp; access</h1>
        <p className="mt-2 text-sm text-ink-600">
          Approve colleagues at {hospital?.name ?? 'your hospital'}. Administrator rights are never
          granted automatically — every one of them passed through this screen.
        </p>
      </header>

      <AccessRequestList initial={requests} />
    </div>
  );
}
