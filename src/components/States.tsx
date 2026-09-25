/**
 * Empty and error states.
 *
 * Two rules here, both of which the rest of the app relies on:
 *
 *  1. An empty state explains *why* it is empty and offers the next step.
 *     "No hospitals found" on its own is a dead end.
 *  2. An error state never shows a raw exception, stack or status code as
 *     the headline. Technical detail is available, but folded away, because
 *     a patient reading "TypeError: undefined" learns nothing and worries.
 */
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FlowCareMark } from '@/components/Brand';

type Action = { label: string; href?: string; onClick?: () => void };

function ActionButton({ action, variant }: { action: Action; variant: 'primary' | 'secondary' }) {
  const cls = variant === 'primary' ? 'fc-btn-primary' : 'fc-btn-secondary';
  if (action.href) {
    return <Link href={action.href} className={`${cls} text-sm`}>{action.label}</Link>;
  }
  return (
    <button type="button" onClick={action.onClick} className={`${cls} text-sm`}>
      {action.label}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  primary,
  secondary,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  primary?: Action;
  secondary?: Action;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-14'}`}
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
        {icon ?? <FlowCareMark size={26} />}
      </span>
      <h3 className="mt-4 text-base font-bold text-ink-900">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-600">{description}</p>
      )}
      {(primary || secondary) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primary && <ActionButton action={primary} variant="primary" />}
          {secondary && <ActionButton action={secondary} variant="secondary" />}
        </div>
      )}
    </div>
  );
}

/** Empty state already wrapped in a card, for use inside a page section. */
export function EmptyCard(props: Parameters<typeof EmptyState>[0]) {
  return (
    <div className="fc-card">
      <EmptyState {...props} />
    </div>
  );
}

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  network: {
    title: "Can't reach FlowCare",
    body: 'Your connection dropped, or our server is briefly unavailable. Nothing you entered has been lost.',
  },
  auth: {
    title: 'You need to sign in',
    body: 'Your session has ended. Sign in again to pick up where you left off.',
  },
  forbidden: {
    title: 'You do not have access to this',
    body: 'This area belongs to a different account or role. If you think that is wrong, ask your hospital administrator.',
  },
  expired: {
    title: 'Your session expired',
    body: 'For your safety FlowCare signs you out after a period of inactivity.',
  },
  booking: {
    title: "That slot can't be requested",
    body: 'It may have filled up while you were choosing. Pick another session and try again.',
  },
  unavailable: {
    title: 'This hospital is unavailable right now',
    body: 'Its record could not be loaded. It may have been unpublished, or the database is briefly unreachable.',
  },
  queue: {
    title: 'Queue information is unavailable',
    body: 'FlowCare shows queue data only when the hospital is actively reporting it. It will reappear when it does.',
  },
  generic: {
    title: 'Something went wrong',
    body: 'That is on us, not you. Try again, and if it keeps happening the detail below will help us fix it.',
  },
};

export function ErrorState({
  kind = 'generic',
  detail,
  onRetry,
  primary,
  secondary,
}: {
  kind?: keyof typeof ERROR_COPY;
  /** Technical detail. Shown only behind a disclosure, never as the headline. */
  detail?: string | null;
  onRetry?: () => void;
  primary?: Action;
  secondary?: Action;
}) {
  const copy = ERROR_COPY[kind] ?? ERROR_COPY.generic;
  return (
    <div className="fc-card px-6 py-12">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <span
          className="grid h-14 w-14 place-items-center rounded-2xl bg-danger-50 text-danger-600 ring-1 ring-danger-100"
          aria-hidden="true"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 8v5" />
            <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
            <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>
        <h3 className="mt-4 text-base font-bold text-ink-900">{copy.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{copy.body}</p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <button type="button" onClick={onRetry} className="fc-btn-primary text-sm">
              Try again
            </button>
          )}
          {primary && <ActionButton action={primary} variant={onRetry ? 'secondary' : 'primary'} />}
          {secondary && <ActionButton action={secondary} variant="secondary" />}
        </div>

        {detail && (
          <details className="mt-6 w-full text-left">
            <summary className="cursor-pointer text-[11px] font-semibold text-ink-500 hover:text-ink-700">
              Technical detail
            </summary>
            <p className="mt-2 break-words rounded-lg bg-ink-50 p-3 font-mono text-[10px] leading-relaxed text-ink-600">
              {detail}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
