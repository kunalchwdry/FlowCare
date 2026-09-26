'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AuthShell, AuthAside, AuthSwitchLink, Field, FormAlert, PasswordField,
  SubmitButton, TextInput, scorePassword,
} from '@/components/auth/AuthKit';

interface Errors { [k: string]: string | null }

export function PatientSignupForm() {
  const router = useRouter();
  const [fullName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function validate(): boolean {
    const e: Errors = {};
    if (fullName.trim().length < 2) e.fullName = 'Enter your full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'Enter a valid email address.';
    // Indian mobile numbers are 10 digits; allow an optional +91 and spacing.
    const digits = phone.replace(/[^\d]/g, '');
    if (phone && !(digits.length === 10 || (digits.length === 12 && digits.startsWith('91')))) {
      e.phone = 'Enter a 10-digit mobile number.';
    }
    if (password.length < 10) e.password = 'Use at least 10 characters.';
    else if (scorePassword(password).score < 2) e.password = 'Choose a stronger password.';
    if (confirm !== password) e.confirm = 'Passwords do not match.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          fullName,
          role: 'patient',
          phone: phone || null,
          dateOfBirth: dob || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFormError(j?.error?.message ?? 'We could not create that account.');
        return;
      }
      if (j.data?.needsConfirmation) {
        setDone(j.data.message ?? 'Check your email to confirm your account, then sign in.');
        return;
      }
      router.push('/patient');
      router.refresh();
    } catch {
      setFormError('We could not reach FlowCare. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell role="patient" title="Almost there" subtitle="One step left before you can sign in.">
        <FormAlert kind="success">{done}</FormAlert>
        <a href="/patient/login" className="fc-btn-secondary mt-5 w-full">Go to sign in</a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      role="patient"
      title="Create your patient account"
      subtitle="You only need this to save hospitals, request appointments and review visits."
      aside={
        <AuthAside
          title="What your account gives you"
          points={[
            'Saved hospitals, private to you',
            'Appointment requests with a reference number',
            'Your place in the queue while you wait',
            'The ability to review visits you actually attended',
          ]}
        />
      }
      footer={<AuthSwitchLink prompt="Already have an account?" href="/patient/login" cta="Sign in" />}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <FormAlert kind="error">{formError}</FormAlert>}

        <Field label="Full name" error={errors.fullName}>
          {(ids) => (
            <TextInput {...ids} value={fullName} autoComplete="name" placeholder="Priya Sharma"
              onChange={(e) => setName(e.target.value)} />
          )}
        </Field>

        <Field label="Email address" error={errors.email}>
          {(ids) => (
            <TextInput {...ids} type="email" value={email} autoComplete="email" placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile number" error={errors.phone} optional
            hint="Used only for appointment updates.">
            {(ids) => (
              <TextInput {...ids} type="tel" value={phone} autoComplete="tel" placeholder="98765 43210"
                onChange={(e) => setPhone(e.target.value)} />
            )}
          </Field>
          <Field label="Date of birth" optional hint="Helps hospitals match your records.">
            {(ids) => (
              <TextInput {...ids} type="date" value={dob} autoComplete="bday"
                onChange={(e) => setDob(e.target.value)} />
            )}
          </Field>
        </div>

        <PasswordField
          label="Password" value={password} onChange={setPassword} error={errors.password}
          showStrength autoComplete="new-password" hint="At least 10 characters."
        />
        <PasswordField
          label="Confirm password" value={confirm} onChange={setConfirm} error={errors.confirm}
          autoComplete="new-password"
        />

        <SubmitButton busy={busy} busyLabel="Creating your account…">Create patient account</SubmitButton>

        <p className="text-center text-[11px] leading-relaxed text-ink-500">
          FlowCare stores only what it needs to run appointments. It never asks for clinical
          details at sign-up, and never sends medical information to an AI provider.
        </p>
      </form>
    </AuthShell>
  );
}
