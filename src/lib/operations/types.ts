import type { RecoveryPolicy, SlotType, QueueEntry } from '@/lib/careAccess/types';

export interface OperationalDepartment {
  id: string;
  hospitalId: string;
  name: string;
  bookingOpen: boolean;
  consultationCapacity: number;
  noShowGraceMinutes: number | null;
  approvalResponseWindowMinutes: number;
  waitlistEnabled: boolean;
  recoveryPolicy: RecoveryPolicy;
  queueOrderRule: 'arrival_order' | 'scheduled_time' | 'manual';
}

export interface NewOperationalDepartment {
  hospitalId: string;
  name: string;
  bookingOpen?: boolean;
  consultationCapacity?: number;
  noShowGraceMinutes?: number | null;
  approvalResponseWindowMinutes?: number;
  waitlistEnabled?: boolean;
  recoveryPolicy?: RecoveryPolicy;
  queueOrderRule?: 'arrival_order' | 'scheduled_time' | 'manual';
}

export interface OperationalService {
  id: string;
  hospitalId: string;
  departmentId: string;
  serviceSlug: string;
  label: string;
  active: boolean;
  source: string;
}

export interface NewOperationalService {
  departmentId: string;
  serviceSlug: string;
  label: string;
  active?: boolean;
}

export interface Provider {
  id: string;
  hospitalId: string;
  departmentId: string;
  name: string;
  specialty: string | null;
  qualification: string | null;
  active: boolean;
}

export interface NewProvider {
  hospitalId: string;
  departmentId: string;
  name: string;
  specialty?: string | null;
  qualification?: string | null;
  active?: boolean;
}

export interface ProviderSchedule {
  id: string;
  providerId: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  active: boolean;
}

export interface NewProviderSchedule {
  providerId: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  active?: boolean;
}

export interface OperationalSlot {
  id: string;
  hospitalId: string;
  departmentId: string;
  providerId: string | null;
  serviceSlug: string | null;
  startsAt: string;
  endsAt: string;
  kind: 'appointment' | 'queue_session';
  capacity: number;
  booked: number;
  bookingOpen: boolean;
  slotType: SlotType;
  waitlistEnabled: boolean;
  approvalResponseWindowMinutes: number;
  recoveryPolicy: RecoveryPolicy;
  expiresAt: string | null;
  updatedAt: string;
  source: 'database' | 'demo_simulated';
}

export interface NewOperationalSlot {
  departmentId: string;
  providerId?: string | null;
  serviceSlug?: string | null;
  startsAt: string;
  endsAt: string;
  kind?: 'appointment' | 'queue_session';
  capacity: number;
  bookingOpen?: boolean;
  slotType: SlotType;
  waitlistEnabled?: boolean;
  approvalResponseWindowMinutes?: number;
  recoveryPolicy?: RecoveryPolicy;
  expiresAt?: string | null;
}

export interface QueueListFilters {
  hospitalId?: string;
  departmentId?: string;
  status?: QueueEntry['status'];
}

export interface QueueListResult {
  entries: QueueEntry[];
  source: 'database' | 'demo_simulated';
  updatedAt: string;
  staleAfterMinutes: number;
}
