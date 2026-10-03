'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AuthShell, AuthAside, AuthSwitchLink, Field, FormAlert, PasswordField, SubmitButton, TextInput,
} from '@/components/auth/AuthKit';

/**
 * One sign-in form, two front doors. The role only decides where you land
 * and what the page says — it is never sent to the server as a claim,
 * because the server decides your role from your account, not from a form.
 */
export function LoginForm({
  role,
  next,
}: {
  role: 'patient' | 'staff';
  /**
   * Where to land after signing in. The hospital portal passes its own
   * destination so staff are not bounced through the patient dashboard on
   * the way to work.
   */
  next?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e: typeof errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'Enter a valid email address.';
    if (!password) e.password = 'Enter your password.';
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const r = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFormError(j?.error?.message ?? 'That email and password did not match.');
        return;
      }
      // The server tells us what this account actually is. If someone signs
      // in through the staff door with a patient account, send them to the
      // patient area rather than a permission error.
      const actual = j?.data?.user?.role ?? 'patient';
      const flowcareReviewer = Boolean(j?.data?.user?.flowcareReviewer);
      if (flowcareReviewer) {
        router.push('/admin/hospital-registrations');
        router.refresh();
        return;
      }
      // `actual` is the role the SERVER resolved, not the door that was
      // used: signing in at the hospital entrance with a patient account
      // still lands on the patient side rather than a portal that would
      // refuse every page.
      /*
       * Where to land, decided from the role the SERVER resolved.
       *
       * On a hospital hostname there is no patient app to fall back to —
       * /patient rewrites to /hospital/patient and 404s — so a patient
       * account signing in there is sent to the apex instead of a dead end.
       */
      const onHospitalHost =
        typeof window !== 'undefined' &&
        /^(hospital|staff)[.-]/.test(window.location.hostname);

      let target: string;
      if (actual === 'patient') {
        target = onHospitalHost ? '/login?from=patient' : '/patient';
      } else {
        target = next ?? (onHospitalHost ? '/' : '/staff');
      }
      router.push(target);
      router.refresh();
    } catch {
      setFormError('We could not reach FlowCare. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const isStaff = role === 'staff';

  return (
    <AuthShell
      role={role}
      title={isStaff ? 'Hospital staff sign in' : 'Welcome back'}
      subtitle={
        isStaff
          ? 'Use the work email your hospital administrator approved.'
          : 'Sign in to see your appointments and queue position.'
      }
      aside={
        isStaff ? (
          <AuthAside
            tone="ink"
            title="Staff access is granted, not claimed"
            points={[
              'Your role is set by your hospital administrator',
              'Every queue change is recorded with who made it',
              'Permissions are enforced in the database, not the interface',
            ]}
          />
        ) : (
          <AuthAside
            title="Your account, your data"
            points={[
              'Appointments and saved hospitals stay private to you',
              'Reviews are tied to visits you actually completed',
              'You can sign out of everything from Settings',
            ]}
          />
        )
      }
      footer={
        isStaff ? (
          <AuthSwitchLink prompt="No access yet?" href="/staff/register" cta="Request staff access" />
        ) : (
          <AuthSwitchLink prompt="New to FlowCare?" href="/patient/signup" cta="Create an account" />
        )
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <FormAlert kind="error">{formError}</FormAlert>}

        <Field label={isStaff ? 'Work email' : 'Email address'} error={errors.email}>
          {(ids) => (
            <TextInput {...ids} type="email" value={email} autoComplete="email"
              placeholder={isStaff ? 'you@hospital.org' : 'you@example.com'}
              onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>

        <PasswordField value={password} onChange={setPassword} error={errors.password} />

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs font-semibold text-brand-700 underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>

        <SubmitButton busy={busy} busyLabel="Signing you in…">Sign in</SubmitButton>

        <p className="text-center text-xs text-ink-500">
          {isStaff ? 'Not staff? ' : 'Are you hospital staff? '}
          <Link
            href={isStaff ? '/patient/login' : '/staff/login'}
            className="font-semibold text-ink-700 underline-offset-4 hover:underline"
          >
            {isStaff ? 'Patient sign in' : 'Use the staff door'}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
