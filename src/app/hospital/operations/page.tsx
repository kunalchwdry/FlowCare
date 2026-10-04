import type { Metadata } from 'next';
import { requireHospitalPermission } from '@/lib/auth/hospital';
import { getRepo } from '@/lib/data';
import { ErrorState } from '@/components/States';
import { HospitalShell } from '@/components/hospital/HospitalShell';
import { HospitalOperationsPanel } from '@/components/hospital/HospitalOperationsPanel';

export const metadata: Metadata = { title: 'Hospital operations · FlowCare' };
export const dynamic = 'force-dynamic';

export default async function HospitalOperationsPage() {
  const gate = await requireHospitalPermission('structure:manage', '/hospital/operations');
  if (gate.kind !== 'ok') return <div className="py-8"><ErrorState kind="forbidden" primary={{ label: 'Back to hospital dashboard', href: '/hospital' }} /></div>;
  const repo = await getRepo();
  const hospital = await repo.getHospital(gate.actor.hospitalId);
  return <HospitalShell actor={gate.actor} hospitalName={hospital?.name ?? 'Your hospital'} active="/hospital/operations" title="Hospital operations" subtitle="Configure supply, publish real slots, and inspect capacity without changing appointment history."><HospitalOperationsPanel canSlots={gate.actor.permissions.includes('slots:manage') || gate.actor.permissions.includes('structure:manage')} canExport={gate.actor.permissions.includes('exports:read')} /></HospitalShell>;
}
