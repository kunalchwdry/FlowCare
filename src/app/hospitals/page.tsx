import { Suspense } from 'react';
import { DiscoveryExplorer } from '@/components/DiscoveryExplorer';

export const metadata = { title: 'Discover hospitals — FlowCare' };
export const dynamic = 'force-dynamic';

export default function HospitalsPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-ink-500">Loading discovery…</p>}>
      <DiscoveryExplorer initialView="list" />
    </Suspense>
  );
}
