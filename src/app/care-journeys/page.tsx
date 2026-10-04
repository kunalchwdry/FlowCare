import type { Metadata } from 'next';
import { CareAccessExchange } from '@/components/CareAccessExchange';

export const metadata: Metadata = { title: 'My care journeys · FlowCare' };
export const dynamic = 'force-dynamic';

export default function CareJourneysPage() {
  return <CareAccessExchange />;
}
