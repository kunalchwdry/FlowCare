import { HospitalProfile } from '@/components/HospitalProfile';

export const dynamic = 'force-dynamic';

export default async function HospitalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HospitalProfile id={id} />;
}
