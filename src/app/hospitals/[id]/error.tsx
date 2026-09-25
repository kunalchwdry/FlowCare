'use client';

import { ErrorState } from '@/components/States';

export default function HospitalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-6">
      <ErrorState
        kind="unavailable"
        onRetry={reset}
        primary={{ label: 'Back to all hospitals', href: '/hospitals' }}
      />
    </div>
  );
}
