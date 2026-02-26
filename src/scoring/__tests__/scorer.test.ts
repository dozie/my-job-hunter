import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/scoring.js', () => ({
  loadScoringConfig: () => ({
    weights: {
      remote_eligible: 3.0,
      seniority_match: 2.5,
      employer_location: 1.5,
      interview_style: 1.5,
      role_type: 1.5,
    },
    role_type_preferences: {
      backend: 1.0,
      platform: 1.0,
      software_engineer: 0.8,
      fullstack: 0.3,
    },
    interview_preferences: {
      assignment: 1.0,
      unknown: 0.5,
      leetcode: 0.0,
    },
    target_seniority: ['senior', 'mid'],
  }),
}));

import { scoreJob } from '../scorer.js';
import type { JobMetadata } from '../analyzer.js';

function makeMeta(overrides: Partial<JobMetadata> = {}): JobMetadata {
  return {
    seniority: 'senior',
    remote_eligible: true,
    interview_style: 'assignment',
    role_type: 'backend',
    ...overrides,
  };
}

describe('scoreJob', () => {
  it('perfect score: remote + senior + backend + assignment + Toronto', () => {
    const { score } = scoreJob(makeMeta(), 'Toronto');
    expect(score).toBe(10.0);
  });

  it('lowest score: not remote + junior + other + leetcode + non-NA location', () => {
    const { score, breakdown } = scoreJob(
      makeMeta({
        remote_eligible: false,
        seniority: 'junior',
        role_type: 'other',
        interview_style: 'leetcode',
      }),
      'Berlin, Germany',
    );
    // 'other' role_type falls through to ?? 0.5 default, so role_type = 0.75
    expect(breakdown.remote).toBe(0);
    expect(breakdown.seniority).toBe(0);
    expect(breakdown.employer_location).toBe(0);
    expect(breakdown.interview_style).toBe(0);
    expect(breakdown.role_type).toBe(0.75);
    expect(score).toBe(0.75);
  });

  it('remote adds weight to score', () => {
    const withRemote = scoreJob(makeMeta({ remote_eligible: true }), 'Toronto');
    const withoutRemote = scoreJob(makeMeta({ remote_eligible: false }), 'Toronto');
    expect(withRemote.breakdown.remote).toBe(3.0);
    expect(withoutRemote.breakdown.remote).toBe(0.0);
  });

  it('senior matches target seniority', () => {
    const { breakdown } = scoreJob(makeMeta({ seniority: 'senior' }));
    expect(breakdown.seniority).toBe(2.5);
  });

  it('mid matches target seniority', () => {
    const { breakdown } = scoreJob(makeMeta({ seniority: 'mid' }));
    expect(breakdown.seniority).toBe(2.5);
  });

  it('lead gets 0.3 factor', () => {
    const { breakdown } = scoreJob(makeMeta({ seniority: 'lead' }));
    expect(breakdown.seniority).toBe(0.75);
  });

  it('staff gets 0.3 factor', () => {
    const { breakdown } = scoreJob(makeMeta({ seniority: 'staff' }));
    expect(breakdown.seniority).toBe(0.75);
  });

  it('junior gets 0 factor', () => {
    const { breakdown } = scoreJob(makeMeta({ seniority: 'junior' }));
    expect(breakdown.seniority).toBe(0);
  });

  it('Toronto location gets employer factor 1.0', () => {
    const { breakdown } = scoreJob(makeMeta(), 'Toronto, ON');
    expect(breakdown.employer_location).toBe(1.5);
  });

  it('Canada Remote gets employer factor 1.0', () => {
    const { breakdown } = scoreJob(makeMeta(), 'Canada Remote');
    expect(breakdown.employer_location).toBe(1.5);
  });

  it('US location gets employer factor 0.5', () => {
    const { breakdown } = scoreJob(makeMeta(), 'San Francisco, CA');
    expect(breakdown.employer_location).toBe(0.75);
  });

  it('US Remote still gets US factor 0.5 (remote handled by remote_eligible)', () => {
    const { breakdown } = scoreJob(makeMeta(), 'San Francisco, CA (Remote)');
    expect(breakdown.employer_location).toBe(0.75);
  });

  it('"Remote" alone gets 0.0 factor (no geography signal)', () => {
    const { breakdown } = scoreJob(makeMeta(), 'Remote');
    expect(breakdown.employer_location).toBe(0.0);
  });

  it('undefined location gets 0.5 factor', () => {
    const { breakdown } = scoreJob(makeMeta(), undefined);
    expect(breakdown.employer_location).toBe(0.75);
  });

  it('non-NA location gets 0.0 factor', () => {
    const { breakdown } = scoreJob(makeMeta(), 'Berlin, Germany');
    expect(breakdown.employer_location).toBe(0.0);
  });

  it('assignment interview gets 1.0 factor', () => {
    const { breakdown } = scoreJob(makeMeta({ interview_style: 'assignment' }));
    expect(breakdown.interview_style).toBe(1.5);
  });

  it('leetcode interview gets 0.0 factor', () => {
    const { breakdown } = scoreJob(makeMeta({ interview_style: 'leetcode' }));
    expect(breakdown.interview_style).toBe(0.0);
  });

  it('fullstack role gets 0.3 factor', () => {
    const { breakdown } = scoreJob(makeMeta({ role_type: 'fullstack' }));
    expect(breakdown.role_type).toBe(0.45);
  });

  it('score is always between 0 and 10', () => {
    const variations: JobMetadata[] = [
      makeMeta(),
      makeMeta({ remote_eligible: false, seniority: 'junior', role_type: 'other', interview_style: 'leetcode' }),
      makeMeta({ seniority: 'lead', role_type: 'fullstack', interview_style: 'unknown' }),
    ];
    for (const meta of variations) {
      const { score } = scoreJob(meta, 'Anywhere');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(10);
    }
  });
});
