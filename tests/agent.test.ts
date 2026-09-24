/**
 * Agent guard tests. The emergency guard is the only thing standing between
 * "I can't breathe" and FlowCare booking a routine outpatient slot for it.
 */
import { describe, it, expect } from 'vitest';
import { agentLooksLikeEmergency, emergencyBlock, buildBookingSummary, AgentIntentSchema, resolveCareNeed } from '@/lib/ai/agent';

describe('agent emergency guard', () => {
  const mustBlock = [
    "chest pain can't breathe",
    'chest pain',
    'chest tightness since morning',
    'cannot breathe properly',
    'my father is breathless',
    'he fainted and is unresponsive',
    'she is having a seizure',
    'slurred speech and face drooping',
    'wound wont stop bleeding',
    'head injury after road accident',
    'baby is not breathing',
    'i want to kill myself',
    // the originals must keep working
    'heart attack',
    'severe bleeding',
    'crushing chest pain',
  ];
  for (const phrase of mustBlock) {
    it(`blocks: "${phrase}"`, () => {
      expect(agentLooksLikeEmergency(phrase)).toBe(true);
      const blocked = emergencyBlock(phrase);
      expect(blocked?.step).toBe('blocked');
      expect(blocked?.message).toBeTruthy();
    });
  }

  const mustNotBlock = [
    'book my leg appointment',
    'knee pain for two months',
    'dialysis near kothrud',
    'eye checkup for my mother',
    'dentist appointment',
    'skin rash',
    'routine diabetes followup',
  ];
  for (const phrase of mustNotBlock) {
    it(`allows: "${phrase}"`, () => {
      expect(agentLooksLikeEmergency(phrase)).toBe(false);
      expect(emergencyBlock(phrase)).toBeNull();
    });
  }
});

describe('agent intent schema', () => {
  it('accepts the allowlisted shape', () => {
    const r = AgentIntentSchema.safeParse({ careNeed: 'leg pain', city: 'Pune' });
    expect(r.success).toBe(true);
  });

  it('rejects anything outside the allowlist', () => {
    // a model trying to smuggle extra instructions must be discarded whole
    const r = AgentIntentSchema.safeParse({ careNeed: 'leg pain', sql: 'drop table hospitals' });
    expect(r.success).toBe(false);
  });

  it('rejects an invented scheduling promise', () => {
    expect(AgentIntentSchema.safeParse({ preferredWhen: '2026-10-01T09:00' }).success).toBe(false);
    expect(AgentIntentSchema.safeParse({ preferredWhen: 'tomorrow' }).success).toBe(true);
  });
});

describe('booking summary', () => {
  it('always says a request is not a confirmation', () => {
    const s = buildBookingSummary({
      hospitalName: 'Baner Ridge', departmentName: 'Orthopaedics',
      startsAt: '2026-10-01T09:00:00Z', patientName: 'Asha', timezone: 'Asia/Kolkata',
    });
    expect(s).toMatch(/still has to confirm/i);
    expect(s).toContain('Baner Ridge');
    expect(s).toContain('Asha');
  });
});

describe('care need resolution', () => {
  it('never narrows an ambiguous need to one department', () => {
    const r = resolveCareNeed('chest pain');
    if (r.departments.length > 1) expect(r.ambiguous).toBe(true);
  });
  it('returns no departments for nonsense rather than guessing', () => {
    expect(resolveCareNeed('qqqzzz').departments.length).toBe(0);
  });
});
