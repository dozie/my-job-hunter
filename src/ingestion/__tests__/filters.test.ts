import { describe, it, expect } from 'vitest';
import { passesRoleFilter, passesLocationFilter } from '../filters.js';
import type { RawJob } from '../providers/base.js';
import type { FiltersConfig } from '../../config/providers.js';

const filters: FiltersConfig = {
  exclude_titles: ['frontend', 'front-end', 'front end', 'ui engineer', 'ux engineer'],
  include_titles: [
    'software', 'engineer', 'developer', 'swe', 'backend',
    'back-end', 'fullstack', 'full-stack', 'full stack', 'platform',
  ],
  location_keywords: ['toronto', 'canada', 'remote'],
  remote_indicators: ['remote', 'work from anywhere', 'work from home', 'fully remote', 'remote-friendly'],
  onsite_indicators: ['#li-onsite', '#li-hybrid', 'in-person', 'in-office', 'on-site', 'onsite', 'hybrid'],
};

function makeJob(overrides: Partial<RawJob>): RawJob {
  return {
    externalId: '1',
    title: 'Software Engineer',
    company: 'Acme',
    link: 'https://example.com',
    ...overrides,
  };
}

describe('passesRoleFilter', () => {
  it('matches inclusion keyword', () => {
    expect(passesRoleFilter(makeJob({ title: 'Software Engineer' }), filters)).toBe(true);
  });

  it('matches inclusion keyword case-insensitively', () => {
    expect(passesRoleFilter(makeJob({ title: 'BACKEND Developer' }), filters)).toBe(true);
  });

  it('excluded keyword takes priority over inclusion', () => {
    expect(passesRoleFilter(makeJob({ title: 'Frontend Software Engineer' }), filters)).toBe(false);
  });

  it('rejects excluded keyword variant', () => {
    expect(passesRoleFilter(makeJob({ title: 'Front-End Developer' }), filters)).toBe(false);
  });

  it('rejects title with no inclusion match', () => {
    expect(passesRoleFilter(makeJob({ title: 'Product Manager' }), filters)).toBe(false);
  });

  it('partial match works', () => {
    expect(passesRoleFilter(makeJob({ title: 'Senior SWE' }), filters)).toBe(true);
  });

  it('exclusion wins when both excluded and included keywords present', () => {
    expect(passesRoleFilter(makeJob({ title: 'UI Engineer' }), filters)).toBe(false);
  });

  it('platform keyword matches', () => {
    expect(passesRoleFilter(makeJob({ title: 'Platform Engineer' }), filters)).toBe(true);
  });
});

describe('passesLocationFilter', () => {
  it('Toronto always passes', () => {
    expect(passesLocationFilter(makeJob({ location: 'Toronto, ON' }), filters)).toBe(true);
  });

  it('Toronto + onsite indicator still passes', () => {
    expect(passesLocationFilter(makeJob({ location: 'Toronto, ON', description: '#LI-Onsite' }), filters)).toBe(true);
  });

  it('Toronto case insensitive', () => {
    expect(passesLocationFilter(makeJob({ location: 'TORONTO' }), filters)).toBe(true);
  });

  it('non-Toronto with remote signal passes', () => {
    expect(passesLocationFilter(makeJob({ location: 'Montreal, QC', description: 'fully remote role' }), filters)).toBe(true);
  });

  it('non-Toronto without remote signal fails', () => {
    expect(passesLocationFilter(makeJob({ location: 'Montreal, QC' }), filters)).toBe(false);
  });

  it('remote in location field passes', () => {
    expect(passesLocationFilter(makeJob({ location: 'Remote - US' }), filters)).toBe(true);
  });

  it('remote + onsite indicator fails', () => {
    expect(passesLocationFilter(makeJob({ location: 'Remote', description: 'hybrid work schedule' }), filters)).toBe(false);
  });

  it('work from home in description passes', () => {
    expect(passesLocationFilter(makeJob({ location: 'Vancouver, BC', description: 'work from home ok' }), filters)).toBe(true);
  });

  it('US city + remote-friendly passes', () => {
    expect(passesLocationFilter(makeJob({ location: 'San Francisco, CA', description: 'remote-friendly' }), filters)).toBe(true);
  });

  it('empty location + remote description passes', () => {
    expect(passesLocationFilter(makeJob({ location: '', description: 'this is a fully remote position' }), filters)).toBe(true);
  });

  it('empty location + no remote signal fails', () => {
    expect(passesLocationFilter(makeJob({ location: '', description: 'great office culture' }), filters)).toBe(false);
  });

  it('Ottawa with no remote signal fails', () => {
    expect(passesLocationFilter(makeJob({ location: 'Ottawa, ON' }), filters)).toBe(false);
  });
});
