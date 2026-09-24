import type { Metadata } from 'next';
import { CareHub } from '@/components/CareHub';

export const metadata: Metadata = {
  title: 'Your care hub · FlowCare',
  description:
    'Private care contexts, visit history and follow-up reminders. FlowCare records where and when, never why.',
};

export const dynamic = 'force-dynamic';

export default function CarePage() {
  return <CareHub />;
}
