import type { Metadata } from 'next';
import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { ErrorState } from '@/components/States';
import { HospitalShell } from '@/components/hospital/HospitalShell';
import { HospitalCareAccessPanel } from '@/components/hospital/HospitalCareAccessPanel';

export const metadata: Metadata = { title: 'Care access queue · FlowCare hospital portal' };
export const dynamic = 'force-dynamic';

export default async function HospitalCareAccessPage() {
  const gate = await requireHospitalPermission('appointments:read', '/hospital/care-access');
  if (gate.kind !== 'ok') return <div className="py-8"><ErrorState kind="forbidden" primary={{ label: 'Back to hospital dashboard', href: '/hospital' }} /></div>;
  const repo = await getRepo();
  const hospital = await repo.getHospital(gate.actor.hospitalId);
  return (
    <HospitalShell actor={gate.actor} hospitalName={hospital?.name ?? 'Your hospital'} active="/hospital/care-access" title="Care access queue" subtitle="Own the referral state until the care loop reaches completion.">
      <HospitalCareAccessPanel hospitalId={gate.actor.hospitalId} canManage={gate.actor.permissions.includes('appointments:manage')} canQueue={gate.actor.permissions.includes('queue:manage')} />
    </HospitalShell>
  );
}
