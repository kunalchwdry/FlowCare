import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = { title: 'Hospital staff sign in — FlowCare' };

export default function StaffLoginPage() {
  return <LoginForm role="staff" />;
}
