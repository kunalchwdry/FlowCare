import { Suspense } from 'react';
import { DiscoveryExplorer } from '@/components/DiscoveryExplorer';

export const metadata = { title: 'Hospital map — FlowCare' };
export const dynamic = 'force-dynamic';

export default function HospitalMapPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-ink-500">Loading map…</p>}>
      <DiscoveryExplorer initialView="map" />
    </Suspense>
  );
}
