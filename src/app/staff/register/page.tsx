import type { Metadata } from 'next';
import { StaffRegisterForm } from '@/components/auth/StaffRegisterForm';

export const metadata: Metadata = {
  title: 'Request hospital staff access — FlowCare',
  description: 'Register your hospital team. Every request is approved by a hospital administrator.',
};

export default function StaffRegisterPage() {
  return <StaffRegisterForm />;
}
