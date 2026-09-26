'use client';

/**
 * Shared authentication UI.
 *
 * One kit for both account types so patient and staff screens are visibly
 * the same product, differing only in the role badge and the fields that
 * genuinely differ. Accessibility is handled here once: every input has a
 * real <label>, errors are wired with aria-describedby + aria-invalid, and
 * the submit state is announced rather than only shown.
 */

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { FlowCareLogo } from '@/components/Brand';

/* ------------------------------------------------------------------ shell */

export function AuthShell({
  role,
  title,
  subtitle,
  children,
  footer,
  aside,
}: {
  role: 'patient' | 'staff';
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl items-start gap-8 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="fc-card animate-fade-up p-6 sm:p-8">
        <FlowCareLogo size="md" href="/" />
        <div className="mt-6">
          <RoleBadge role={role} />
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{subtitle}</p>}
        </div>
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 border-t border-ink-100 pt-5 text-sm text-ink-600">{footer}</div>}
      </div>
      {aside && <div className="hidden lg:block">{aside}</div>}
    </div>
  );
}

/**
 * Persistent indicator of which kind of account is being created, so nobody
 * gets three fields into the wrong flow before noticing.
 */
export function RoleBadge({ role }: { role: 'patient' | 'staff' }) {
  return role === 'patient' ? (
    <span className="fc-pill-brand">Patient account</span>
  ) : (
    <span className="fc-pill bg-ink-900 text-white">Hospital staff account</span>
  );
}

/* ----------------------------------------------------------------- fields */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  htmlFor?: string;
  optional?: boolean;
}) {
  const auto = useId();
  const id = htmlFor ?? auto;
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800">{label}</span>
        {optional && <span className="text-[11px] font-medium text-ink-400">Optional</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && <p id={hintId} className="fc-hint">{hint}</p>}
      {error && (
        <p id={errId} className="fc-error" role="alert">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-px shrink-0">
            <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5" strokeLinecap="round" /><circle cx="12" cy="16" r=".7" fill="currentColor" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  id, describedBy, invalid, ...rest
}: {
  id: string; describedBy?: string; invalid?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={`fc-input ${invalid ? 'fc-input-error' : ''}`}
      {...rest}
    />
  );
}

/* --------------------------------------------------------------- password */

export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; tips: string[] }

/**
 * Deliberately simple and local: length first (which dominates real-world
 * strength), then variety. No password is ever sent anywhere to be scored.
 */
export function scorePassword(pw: string): Strength {
  const tips: string[] = [];
  if (pw.length < 10) tips.push('Use at least 10 characters');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) tips.push('Mix upper and lower case');
  if (!/[0-9]/.test(pw)) tips.push('Add a number');
  if (!/[^A-Za-z0-9]/.test(pw)) tips.push('Add a symbol');

  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 14) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  if (pw.length < 8) score = 0;

  const label = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score];
  return { score: score as Strength['score'], label, tips };
}

export function PasswordField({
  label = 'Password',
  value,
  onChange,
  error,
  showStrength = false,
  autoComplete = 'current-password',
  hint,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  showStrength?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? scorePassword(value) : null;
  const barColor = ['bg-ink-200', 'bg-danger-500', 'bg-warn-500', 'bg-brand-400', 'bg-success-500'];

  return (
    <Field label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <>
          <div className="relative">
            <input
              id={id}
              type={visible ? 'text' : 'password'}
              value={value}
              autoComplete={autoComplete}
              onChange={(e) => onChange(e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={`fc-input pr-24 ${invalid ? 'fc-input-error' : ''}`}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-pressed={visible}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-500 hover:bg-ink-100 hover:text-ink-700"
            >
              {visible ? 'Hide' : 'Show'}
            </button>
          </div>

          {strength && value.length > 0 && (
            <div className="mt-2">
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      i < strength.score ? barColor[strength.score] : 'bg-ink-200'
                    }`}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-[11px] font-medium text-ink-600" aria-live="polite">
                Password strength: <span className="font-bold">{strength.label}</span>
                {strength.tips.length > 0 && (
                  <span className="font-normal text-ink-500"> — {strength.tips[0]}</span>
                )}
              </p>
            </div>
          )}
        </>
      )}
    </Field>
  );
}

/* --------------------------------------------------------------- feedback */

export function FormAlert({
  kind, children,
}: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const tone = {
    error: 'bg-danger-50 text-danger-900 ring-danger-200',
    success: 'bg-success-50 text-success-700 ring-success-100',
    info: 'bg-brand-50 text-brand-900 ring-brand-200',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3.5 py-3 text-sm ring-1 ${tone}`}>
      {children}
    </div>
  );
}

export function SubmitButton({
  busy, children, busyLabel = 'Working…',
}: { busy: boolean; children: ReactNode; busyLabel?: string }) {
  return (
    <button type="submit" disabled={busy} className="fc-btn-primary w-full" aria-busy={busy}>
      {busy ? (
        <>
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function AuthAside({
  title, points, tone = 'brand',
}: { title: string; points: string[]; tone?: 'brand' | 'ink' }) {
  return (
    <aside className={`rounded-2xl p-6 ${tone === 'brand' ? 'bg-brand-600 text-white' : 'bg-ink-900 text-white'}`}>
      <h2 className="text-base font-bold">{title}</h2>
      <ul className="mt-4 space-y-3">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-white/90">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <path d="m20 6-11 11-5-5" />
            </svg>
            {p}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function AuthSwitchLink({ prompt, href, cta }: { prompt: string; href: string; cta: string }) {
  return (
    <p>
      {prompt}{' '}
      <Link href={href} className="font-semibold text-brand-700 underline-offset-4 hover:underline">
        {cta}
      </Link>
    </p>
  );
}
