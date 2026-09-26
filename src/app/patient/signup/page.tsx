import type { Metadata } from 'next';
import { PatientSignupForm } from '@/components/auth/PatientSignupForm';

export const metadata: Metadata = {
  title: 'Create your patient account — FlowCare',
  description: 'Sign up to request appointments and track your place in the queue.',
};

export default function PatientSignupPage() {
  return <PatientSignupForm />;
}
