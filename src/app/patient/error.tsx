'use client';

import { ErrorState } from '@/components/States';

export default function PatientError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-6">
      <ErrorState kind="generic" onRetry={reset} primary={{ label: 'Find a hospital', href: '/hospitals' }} />
    </div>
  );
}
