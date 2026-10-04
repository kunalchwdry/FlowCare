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
      ['book', 'patient', 'BOOKED'],
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
