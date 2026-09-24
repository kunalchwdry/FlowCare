import type { Metadata } from 'next';
import { VisitCard } from '@/components/VisitCard';

export const metadata: Metadata = {
  title: 'Visit card · FlowCare',
  description: 'An offline-friendly card with the gate, the counter and what to bring.',
};

export const dynamic = 'force-dynamic';

export default async function VisitCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VisitCard hospitalId={id} />;
}
