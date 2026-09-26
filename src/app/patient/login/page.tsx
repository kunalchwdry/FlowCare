import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = { title: 'Patient sign in — FlowCare' };

export default function PatientLoginPage() {
  return <LoginForm role="patient" />;
}
