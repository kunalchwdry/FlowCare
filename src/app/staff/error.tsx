'use client';

import { ErrorState } from '@/components/States';

export default function StaffError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-6">
      <ErrorState kind="generic" onRetry={reset} primary={{ label: 'Staff sign in', href: '/staff/login' }} />
    </div>
  );
}
