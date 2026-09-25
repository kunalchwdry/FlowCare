'use client';

import { ErrorState } from '@/components/States';

export default function HospitalsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-6">
      <ErrorState
        kind="network"
        onRetry={reset}
        primary={{ label: 'Go to the home page', href: '/' }}
      />
    </div>
  );
}
