import type { Metadata } from 'next';
import { CorrectionQueue } from '@/components/CorrectionQueue';

export const metadata: Metadata = {
  title: 'Correction queue · FlowCare admin',
};

export const dynamic = 'force-dynamic';

export default function AdminCorrectionsPage() {
  return <CorrectionQueue />;
}
