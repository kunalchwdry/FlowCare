import type { Metadata } from 'next';
import { CareAccessExchange } from '@/components/CareAccessExchange';

export const metadata: Metadata = {
  title: 'Care Access Exchange · FlowCare',
  description: 'Match to feasible care options, coordinate referrals and follow the journey until it closes.',
};

export const dynamic = 'force-dynamic';

export default function CareAccessPage() {
  return <CareAccessExchange />;
}
