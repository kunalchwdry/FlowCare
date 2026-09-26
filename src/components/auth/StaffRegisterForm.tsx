'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AuthShell, AuthAside, AuthSwitchLink, Field, FormAlert, PasswordField,
  SubmitButton, TextInput, scorePassword,
} from '@/components/auth/AuthKit';
import { FlowCareLogo } from '@/components/Brand';

const ROLES = [
  { value: 'hospital_admin', label: 'Hospital Administrator', note: 'Approves colleagues, manages staff and settings' },
  { value: 'doctor', label: 'Doctor', note: 'Consultations and the clinical queue' },
  { value: 'receptionist', label: 'Receptionist', note: 'Check-in, appointments, front desk' },
  { value: 'nurse', label: 'Nurse', note: 'Triage and patient flow' },
  { value: 'staff', label: 'Staff', note: 'General operational access' },
] as const;

interface Hospital { id: string; name: string; city: string | null }

export function StaffRegisterForm() {
  const [hospitals, setHospitals] = useState<Hospital[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [fullName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [requestedRole, setRole] = useState<string>('');
  const [staffId, setStaffId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<{ hospitalName: string; role: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/hospitals/directory')
      .then((r) => r.json())
      .then((j) => { if (live) setHospitals(j?.data?.hospitals ?? []); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, []);

  const selectedRole = useMemo(() => ROLES.find((r) => r.value === requestedRole), [requestedRole]);

  function validate(): boolean {
    const e: Record<string, string | null> = {};
    if (fullName.trim().length < 2) e.fullName = 'Enter your full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'Enter a valid work email address.';
    if (!hospitalId) e.hospitalId = 'Select the hospital you work at.';
    if (!requestedRole) e.requestedRole = 'Select your role.';
    if (!staffId.trim()) e.staffId = 'Enter the staff or employee ID your hospital issued you.';
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
      // Step 1: the account itself. It is created with no elevated role —
      // the server refuses to take a role from this request.
      const signup = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName, role: 'patient', phone: phone || null }),
      });
      const sj = await signup.json();
      const accountBlocked = !signup.ok && !/already|check your email/i.test(sj?.error?.message ?? '');
      if (accountBlocked && signup.status !== 503) {
        setFormError(sj?.error?.message ?? 'We could not create that account.');
        return;
      }

      // Step 2: the access request an administrator has to act on.
      const r = await fetch('/api/staff/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, fullName, hospitalId, requestedRole, staffId: staffId || null }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFormError(j?.error?.message ?? 'We could not submit your request.');
        return;
      }
      setSubmitted({
        hospitalName: j.data.request.hospitalName,
        role: selectedRole?.label ?? 'Staff',
      });
    } catch {
      setFormError('We could not reach FlowCare. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------------------------------- pending approval */
  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-lg py-8">
        <div className="fc-card animate-scale-in p-7 text-center">
          <FlowCareLogo size="md" href="/" className="justify-center" />
          <span
            className="mx-auto mt-7 grid h-16 w-16 place-items-center rounded-2xl bg-warn-50 text-warn-600 ring-1 ring-warn-200"
            aria-hidden="true"
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
          </span>
          <h1 className="mt-5 text-xl font-extrabold tracking-tight text-ink-900">
            Request submitted — awaiting approval
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
            Your request has been submitted. A hospital administrator must approve your access.
          </p>

          <dl className="mt-6 space-y-2.5 rounded-xl bg-ink-50 p-4 text-left text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Hospital</dt>
              <dd className="text-right font-semibold text-ink-900">{submitted.hospitalName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Requested role</dt>
              <dd className="text-right font-semibold text-ink-900">{submitted.role}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Status</dt>
              <dd className="text-right"><span className="fc-pill-warn">Pending approval</span></dd>
            </div>
          </dl>

          <p className="mt-5 text-xs leading-relaxed text-ink-500">
            Until then you can sign in, but the staff area will stay locked. You will not be able
            to see patient or queue data, and no administrator rights are granted automatically —
            not even if you requested them.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Link href="/staff/login" className="fc-btn-primary w-full">Go to staff sign in</Link>
            <Link href="/hospitals" className="fc-btn-ghost w-full">Browse hospitals meanwhile</Link>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- form */
  return (
    <AuthShell
      role="staff"
      title="Request hospital staff access"
      subtitle="Tell us where you work and what you do. Your hospital administrator reviews every request."
      aside={
        <AuthAside
          tone="ink"
          title="Why this is not instant"
          points={[
            'Staff accounts can see patient appointments',
            'Only an existing administrator can approve a colleague',
            'Administrator rights are never granted by signing up',
            'Every approval is recorded against the person who made it',
          ]}
        />
      }
      footer={<AuthSwitchLink prompt="Already approved?" href="/staff/login" cta="Staff sign in" />}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <FormAlert kind="error">{formError}</FormAlert>}

        <Field label="Full name" error={errors.fullName}>
          {(ids) => <TextInput {...ids} value={fullName} autoComplete="name" placeholder="Dr Anil Kulkarni"
            onChange={(e) => setName(e.target.value)} />}
        </Field>

        <Field label="Work email" error={errors.email} hint="Use your hospital address if you have one.">
          {(ids) => <TextInput {...ids} type="email" value={email} autoComplete="email" placeholder="you@hospital.org"
            onChange={(e) => setEmail(e.target.value)} />}
        </Field>

        <Field label="Contact number" optional>
          {(ids) => <TextInput {...ids} type="tel" value={phone} autoComplete="tel" placeholder="98765 43210"
            onChange={(e) => setPhone(e.target.value)} />}
        </Field>

        <Field label="Hospital" error={errors.hospitalId}>
          {({ id, describedBy, invalid }) => (
            <select
              id={id} value={hospitalId} aria-describedby={describedBy} aria-invalid={invalid || undefined}
              onChange={(e) => setHospitalId(e.target.value)}
              disabled={hospitals === null && !loadFailed}
              className={`fc-input ${invalid ? 'fc-input-error' : ''}`}
            >
              <option value="">
                {hospitals === null && !loadFailed ? 'Loading hospitals…' : 'Select your hospital'}
              </option>
              {(hospitals ?? []).map((h) => (
                <option key={h.id} value={h.id}>{h.city ? `${h.name} — ${h.city}` : h.name}</option>
              ))}
            </select>
          )}
        </Field>
        {loadFailed && (
          <FormAlert kind="error">
            We could not load the hospital list. Refresh the page and try again.
          </FormAlert>
        )}

        <Field label="Your role" error={errors.requestedRole}>
          {({ id, describedBy, invalid }) => (
            <select
              id={id} value={requestedRole} aria-describedby={describedBy} aria-invalid={invalid || undefined}
              onChange={(e) => setRole(e.target.value)}
              className={`fc-input ${invalid ? 'fc-input-error' : ''}`}
            >
              <option value="">Select your role</option>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          )}
        </Field>
        {selectedRole && (
          <p className="-mt-2 text-[11px] leading-relaxed text-ink-500">{selectedRole.note}.</p>
        )}
        {requestedRole === 'hospital_admin' && (
          <FormAlert kind="info">
            Administrator is the highest level of access. It is never granted automatically —
            an existing administrator at this hospital has to approve it.
          </FormAlert>
        )}

        <Field label="Staff / employee ID" error={errors.staffId}
          hint="Your administrator uses this to confirm you work there.">
          {(ids) => <TextInput {...ids} value={staffId} placeholder="e.g. EMP-4821"
            onChange={(e) => setStaffId(e.target.value)} />}
        </Field>

        <PasswordField label="Password" value={password} onChange={setPassword} error={errors.password}
          showStrength autoComplete="new-password" hint="At least 10 characters." />
        <PasswordField label="Confirm password" value={confirm} onChange={setConfirm}
          error={errors.confirm} autoComplete="new-password" />

        <SubmitButton busy={busy} busyLabel="Submitting your request…">Submit access request</SubmitButton>

        <p className="text-center text-[11px] leading-relaxed text-ink-500">
          Submitting creates your sign-in and a pending request. It does not give you access to
          patient data.
        </p>
      </form>
    </AuthShell>
  );
}
