'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/States';

/**
 * Root error boundary. The user sees plain language; the digest (which is
 * safe to show — it is an opaque id, not a stack) is tucked behind a
 * disclosure so support can correlate it with the server log.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side detail stays server-side; this is only for the browser console.
    console.error(error);
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        kind="generic"
        detail={error.digest ? `Reference: ${error.digest}` : null}
        onRetry={reset}
        primary={{ label: 'Go to the home page', href: '/' }}
      />
    </div>
  );
}
