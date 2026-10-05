import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractCareAccessRequest } from '@/lib/careAccess/extract';
import { CareAccessTransitionError, planCareAccessTransition } from '@/lib/careAccess/stateMachine';
import type { CareAccessState } from '@/lib/careAccess/types';

describe('care access request extraction', () => {
  it('extracts only bounded administrative fields', () => {
    const result = extractCareAccessRequest('I need an orthopedic consultation near Pune next week in the morning');
    expect(result.specialty).toBe('orthopaedics');
    expect(result.serviceType).toBe('consultation');
    expect(result.location).toBe('pune');
    expect(result.preferredTimeRange).toBe('morning');
    expect(result.preferredStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.preferredEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).not.toHaveProperty('urgency');
    expect(result).not.toHaveProperty('diagnosis');
  });

  it('leaves unknown clinical language unclassified', () => {
    const result = extractCareAccessRequest('I feel very unwell and need help soon');
    expect(result.specialty).toBeNull();
    expect(result.referralRequired).toBeNull();
  });

  it('does not swallow later constraints into the location field', () => {
    const result = extractCareAccessRequest('I need cardiology in Baner after work with wheelchair access');
    expect(result.location).toBe('baner');
    expect(result.preferredTimeRange).toBe('evening');
    expect(result.accessibilityRequirements).toContain('wheelchair-accessible-entrance');
  });
});

describe('Care Access patient-facing booking truth', () => {
  const patientUi = readFileSync(resolve(process.cwd(), 'src/components/CareAccessExchange.tsx'), 'utf8');
  const instantRoute = readFileSync(resolve(process.cwd(), 'src/app/api/care-requests/[id]/options/[optionId]/select/route.ts'), 'utf8');
  const patientActionRoute = readFileSync(resolve(process.cwd(), 'src/app/api/care-requests/[id]/route.ts'), 'utf8');
  const bookingTruthMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0023_care_access_booking_truth.sql'), 'utf8');
  const hospitalUi = readFileSync(resolve(process.cwd(), 'src/components/hospital/HospitalCareAccessPanel.tsx'), 'utf8');

  it('labels a sent request separately from a hospital-confirmed booking', () => {
    expect(patientUi).toContain("REFERRAL_SUBMITTED: 'Request sent — awaiting hospital confirmation'");
    expect(patientUi).toContain("BOOKED: 'Hospital confirmed'");
    expect(patientUi).toContain('Request hospital confirmation');
    expect(patientUi).not.toContain("BOOKED: 'Booking confirmed'");
  });

  it('routes instant-slot selection and offered-slot requests through pending referral state', () => {
    expect(instantRoute).toContain("action: 'submit_referral'");
    expect(instantRoute).toContain("confirmation: 'pending_hospital'");
    expect(patientActionRoute).toContain("const transitionAction = body.action === 'book' ? 'submit_referral' : body.action;");
  });

  it('keeps the live instant-slot RPC in requested status until hospital acceptance', () => {
    expect(bookingTruthMigration).toContain("'requested', q, st");
    expect(bookingTruthMigration).toContain("'approval_pending', null, s.starts_at");
    expect(bookingTruthMigration).not.toContain("case when st = 'instant' then 'confirmed' else 'requested' end");
  });

  it('keeps acknowledgement and acceptance visible in the hospital queue', () => {
    expect(hospitalUi).toContain("if (state === 'REFERRAL_SUBMITTED') return ['acknowledge'];");
    expect(hospitalUi).toContain("if (state === 'ACKNOWLEDGED') return ['accept', 'request_info', 'redirect'];");
    expect(hospitalUi).toContain('Accept and confirm appointment');
  });
});

describe('care access state machine', () => {
  it('permits the core request-to-referral path', () => {
    let version = 1;
    let state: CareAccessState = 'REQUESTED';
    for (const [action, actor, next] of [
      ['screen', 'system', 'SCREENED'],
      ['offer_options', 'system', 'OPTIONS_OFFERED'],
      ['select_option', 'patient', 'PATIENT_SELECTED'],
      ['submit_referral', 'patient', 'REFERRAL_SUBMITTED'],
      ['acknowledge', 'hospital', 'ACKNOWLEDGED'],
      ['accept', 'hospital', 'ACCEPTED'],
      ['offer_slot', 'hospital', 'SLOT_OFFERED'],
      ['submit_referral', 'patient', 'REFERRAL_SUBMITTED'],
      ['acknowledge', 'hospital', 'ACKNOWLEDGED'],
      ['accept', 'hospital', 'ACCEPTED'],
      ['confirm_booking', 'system', 'BOOKED'],
    ] as const) {
      const plan = planCareAccessTransition(state, {
        careRequestId: 'care-1', action, actor: actor as never, actorId: 'actor', actorRole: actor,
        expectedVersion: version, optionId: ['offer_options', 'select_option', 'offer_slot'].includes(action) ? 'option-1' : null,
      }, version);
      expect(plan.to).toBe(next);
      state = plan.to;
      version += 1;
    }
    expect(state).toBe('BOOKED');
  });

  it('keeps an instant-slot request pending until hospital acceptance', () => {
    const submitted = planCareAccessTransition('PATIENT_SELECTED', {
      careRequestId: 'care-1', action: 'submit_referral', actor: 'patient', actorId: 'patient', actorRole: 'patient',
      appointmentId: 'appointment-1', metadata: { slotType: 'instant' },
    });
    expect(submitted.to).toBe('REFERRAL_SUBMITTED');
    expect(() => planCareAccessTransition('REFERRAL_SUBMITTED', {
      careRequestId: 'care-1', action: 'book', actor: 'patient', actorId: 'patient', actorRole: 'patient',
    })).toThrowError(CareAccessTransitionError);

    const accepted = planCareAccessTransition(submitted.to, {
      careRequestId: 'care-1', action: 'accept', actor: 'hospital', actorId: 'staff', actorRole: 'staff',
    });
    expect(accepted.to).toBe('ACCEPTED');
    expect(planCareAccessTransition(accepted.to, {
      careRequestId: 'care-1', action: 'confirm_booking', actor: 'system', actorId: 'system', actorRole: 'system',
      appointmentId: 'appointment-1',
    }).to).toBe('BOOKED');
  });

  it('rejects skipping from request to service completion', () => {
    expect(() => planCareAccessTransition('REQUESTED', {
      careRequestId: 'care-1', action: 'complete', actor: 'hospital', actorId: 'staff', actorRole: 'staff',
    })).toThrowError(CareAccessTransitionError);
  });

  it('requires a reason for operationally sensitive transitions', () => {
    expect(() => planCareAccessTransition('ACKNOWLEDGED', {
      careRequestId: 'care-1', action: 'request_info', actor: 'hospital', actorId: 'staff', actorRole: 'staff',
    })).toThrow(/reason is required/i);
  });

  it('rejects stale optimistic versions', () => {
    expect(() => planCareAccessTransition('BOOKED', {
      careRequestId: 'care-1', action: 'arrive', actor: 'hospital', actorId: 'staff', actorRole: 'staff', expectedVersion: 2,
    }, 3)).toThrow(/changed/i);
  });

  it('supports an approval-required path without automatic clinical ordering', () => {
    const selected = planCareAccessTransition('OPTIONS_OFFERED', {
      careRequestId: 'care-1', action: 'select_option', actor: 'patient', actorId: 'patient', actorRole: 'patient', optionId: 'slot-a',
    });
    expect(selected.to).toBe('PATIENT_SELECTED');
    const pending = planCareAccessTransition(selected.to, {
      careRequestId: 'care-1', action: 'request_approval', actor: 'patient', actorId: 'patient', actorRole: 'patient', optionId: 'slot-a',
    });
    expect(pending.to).toBe('APPROVAL_PENDING');
    const expired = planCareAccessTransition(pending.to, {
      careRequestId: 'care-1', action: 'expire_approval', actor: 'system', actorId: 'system', actorRole: 'system', reason: 'Approval deadline passed.',
    });
    expect(expired.to).toBe('APPROVAL_EXPIRED');
    expect(planCareAccessTransition(expired.to, {
      careRequestId: 'care-1', action: 'request_recovery', actor: 'system', actorId: 'system', actorRole: 'system', reason: 'Hospital did not respond.',
    }).to).toBe('RECOVERY_REQUIRED');
  });

  it('supports a waitlist path and keeps queue ordering explicit', () => {
    const selected = planCareAccessTransition('OPTIONS_OFFERED', {
      careRequestId: 'care-1', action: 'select_option', actor: 'patient', actorId: 'patient', actorRole: 'patient', optionId: 'slot-w',
    });
    expect(planCareAccessTransition(selected.to, {
      careRequestId: 'care-1', action: 'join_waitlist', actor: 'patient', actorId: 'patient', actorRole: 'patient', optionId: 'slot-w',
      metadata: { queueRule: 'arrival_order' },
    }).to).toBe('WAITLISTED');
  });

  it('rejects invalid approval actions and missing recovery reasons', () => {
    expect(() => planCareAccessTransition('OPTIONS_OFFERED', {
      careRequestId: 'care-1', action: 'approve', actor: 'hospital', actorId: 'staff', actorRole: 'staff',
    })).toThrow(/cannot move/i);
    expect(() => planCareAccessTransition('APPROVAL_EXPIRED', {
      careRequestId: 'care-1', action: 'request_recovery', actor: 'system', actorId: 'system', actorRole: 'system',
    })).toThrow(/reason is required/i);
  });
});
