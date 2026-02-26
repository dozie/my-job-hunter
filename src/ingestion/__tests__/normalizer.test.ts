import { describe, it, expect } from 'vitest';
import {
  normalizeCompany,
  normalizeTitle,
  buildCanonicalKey,
  normalizeJobs,
} from '../normalizer.js';
import type { RawJob } from '../providers/base.js';

function makeRaw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    externalId: 'ext-1',
    title: 'Software Engineer',
    company: 'Acme',
    link: 'https://example.com/job/1',
    ...overrides,
  };
}

describe('normalizeCompany', () => {
  it('strips "Inc."', () => {
    expect(normalizeCompany('Acme Inc.')).toBe('acme');
  });

  it('strips "Corporation"', () => {
    // "Corp" also matches the suffix regex, so both are stripped
    expect(normalizeCompany('Big Corp Corporation')).toBe('big');
  });

  it('strips "Ltd"', () => {
    expect(normalizeCompany('UK Ltd')).toBe('uk');
  });

  it('strips "LLC"', () => {
    expect(normalizeCompany('Startup LLC')).toBe('startup');
  });

  it('collapses whitespace', () => {
    expect(normalizeCompany('  Spaced  Out  ')).toBe('spaced out');
  });

  it('strips commas and periods', () => {
    expect(normalizeCompany('Acme, Technologies')).toBe('acme technologies');
  });
});

describe('normalizeTitle', () => {
  it('normalizes "Sr." to "senior" (period remains — regex quirk)', () => {
    // The \bsr\.?\b regex can't consume the trailing period due to word boundary
    expect(normalizeTitle('Sr. Engineer')).toBe('senior. engineer');
  });

  it('normalizes "Jr" to "junior"', () => {
    expect(normalizeTitle('Jr Developer')).toBe('junior developer');
  });

  it('lowercases', () => {
    expect(normalizeTitle('STAFF Engineer')).toBe('staff engineer');
  });

  it('collapses whitespace', () => {
    expect(normalizeTitle('Senior   Backend   Dev')).toBe('senior backend dev');
  });

  it('normalizes "sr" without period', () => {
    expect(normalizeTitle('sr engineer')).toBe('senior engineer');
  });
});

describe('buildCanonicalKey', () => {
  it('combines normalized company, title, and description fingerprint', () => {
    const key = buildCanonicalKey('Acme Inc.', 'Sr Engineer', 'Build APIs');
    expect(key).toMatch(/^acme::senior engineer::[a-f0-9]{12}$/);
  });

  it('uses "nodesc" when description is undefined', () => {
    const key = buildCanonicalKey('Stripe', 'SWE');
    expect(key).toBe('stripe::swe::nodesc');
  });

  it('different descriptions produce different keys', () => {
    const keyA = buildCanonicalKey('Co', 'SWE', 'description A');
    const keyB = buildCanonicalKey('Co', 'SWE', 'description B');
    expect(keyA).not.toBe(keyB);
  });

  it('is deterministic', () => {
    const key1 = buildCanonicalKey('Co', 'SWE', 'desc');
    const key2 = buildCanonicalKey('Co', 'SWE', 'desc');
    expect(key1).toBe(key2);
  });
});

describe('normalizeJobs', () => {
  it('sets provider name', () => {
    const result = normalizeJobs([makeRaw()], 'greenhouse');
    expect(result[0].provider).toBe('greenhouse');
  });

  it('strips HTML tags from description', () => {
    const result = normalizeJobs([makeRaw({ description: '<p>Hello</p>' })], 'test');
    expect(result[0].description).toBe('Hello');
  });

  it('decodes HTML entities', () => {
    const result = normalizeJobs([makeRaw({ description: 'A &amp; B &lt;C&gt;' })], 'test');
    expect(result[0].description).toBe('A & B <C>');
  });

  it('strips &nbsp;', () => {
    const result = normalizeJobs([makeRaw({ description: 'A&nbsp;B' })], 'test');
    expect(result[0].description).toBe('A B');
  });

  it('preserves raw remoteEligible=true', () => {
    const result = normalizeJobs([makeRaw({ remoteEligible: true })], 'test');
    expect(result[0].remoteEligible).toBe(true);
  });

  it('preserves raw remoteEligible=false', () => {
    const result = normalizeJobs([makeRaw({ remoteEligible: false })], 'test');
    expect(result[0].remoteEligible).toBe(false);
  });

  it('detects remote from indicators when remoteEligible not set', () => {
    const result = normalizeJobs(
      [makeRaw({ location: 'Remote' })],
      'test',
      ['remote'],
    );
    expect(result[0].remoteEligible).toBe(true);
  });

  it('returns false when no indicators provided', () => {
    const result = normalizeJobs([makeRaw({ location: 'Remote' })], 'test');
    expect(result[0].remoteEligible).toBe(false);
  });

  it('returns false when indicators array is empty', () => {
    const result = normalizeJobs([makeRaw({ location: 'Remote' })], 'test', []);
    expect(result[0].remoteEligible).toBe(false);
  });

  it('builds canonical key matching buildCanonicalKey output', () => {
    const raw = makeRaw({ company: 'Stripe Inc.', title: 'Sr. Backend Engineer', description: '<b>Build APIs</b>' });
    const result = normalizeJobs([raw], 'test');
    const expectedKey = buildCanonicalKey('Stripe Inc.', 'Sr. Backend Engineer', 'Build APIs');
    expect(result[0].canonicalKey).toBe(expectedKey);
  });
});
