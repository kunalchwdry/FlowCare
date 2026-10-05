/**
 * Patient reliability is an explanation of verified FlowCare appointment
 * outcomes. It is not a clinical score, a payment score, or a prediction.
 */
export type ReliabilityEventType = 'attended' | 'late_cancellation' | 'no_show';

export interface ReliabilityEvent {
  id: string;
  appointmentId: string;
  type: ReliabilityEventType;
  pointsDelta: number;
  occurredAt: string;
}

export interface PatientReliability {
  score: number;
  updatedAt: string | null;
  status: 'excellent' | 'good' | 'needs_improvement' | 'poor';
  completedCount: number;
  cancelledCount: number;
  lateCancellationCount: number;
  noShowCount: number;
  pointHistory: ReliabilityEvent[];
}

/** A privacy-safe, immutable view derived from completed appointments. */
export interface VerifiedVisit {
  appointmentId: string;
  hospitalId: string;
  hospitalName: string | null;
  departmentName: string | null;
  visitDate: string;
  status: 'completed';
  appointmentKind: string | null;
}

export interface HospitalPatientProfile {
  patientId: string;
  reliability: Omit<PatientReliability, 'pointHistory'>;
  recentVisits: VerifiedVisit[];
}

/** Central rules shared by the demo adapter, UI copy and tests. */
export const RELIABILITY_RULES = {
  startingScore: 100,
  attended: 1,
  lateCancellation: -3,
  noShow: -10,
  lateCancellationWindowHours: 24,
  thresholds: {
    excellent: 90,
    good: 75,
    needsImprovement: 50,
  },
} as const;

export function reliabilityStatus(score: number): PatientReliability['status'] {
  if (score >= RELIABILITY_RULES.thresholds.excellent) return 'excellent';
  if (score >= RELIABILITY_RULES.thresholds.good) return 'good';
  if (score >= RELIABILITY_RULES.thresholds.needsImprovement) return 'needs_improvement';
  return 'poor';
}

export function reliabilityStatusLabel(status: PatientReliability['status']): string {
  return {
    excellent: 'Excellent standing',
    good: 'Good standing',
    needs_improvement: 'Needs improvement',
    poor: 'Low standing',
  }[status];
}

export function clampReliabilityScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
