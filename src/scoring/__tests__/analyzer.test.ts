import { describe, it, expect } from 'vitest';
import { inferSeniorityFromTitle } from '../analyzer.js';

describe('inferSeniorityFromTitle', () => {
  describe('staff/principal detection', () => {
    it('detects "Staff" in title', () => {
      expect(inferSeniorityFromTitle('Staff Software Engineer')).toBe('staff');
    });

    it('detects "Principal" in title', () => {
      expect(inferSeniorityFromTitle('Principal Engineer')).toBe('staff');
    });

    it('detects case-insensitive "STAFF"', () => {
      expect(inferSeniorityFromTitle('STAFF ENGINEER')).toBe('staff');
    });
  });

  describe('lead detection', () => {
    it('detects "Lead" in title', () => {
      expect(inferSeniorityFromTitle('Lead Backend Engineer')).toBe('lead');
    });

    it('detects "Engineering Manager"', () => {
      expect(inferSeniorityFromTitle('Engineering Manager, Platform')).toBe('lead');
    });

    it('detects "EM" as standalone word', () => {
      expect(inferSeniorityFromTitle('EM - Infrastructure')).toBe('lead');
    });
  });

  describe('senior detection', () => {
    it('detects "Senior" in title', () => {
      expect(inferSeniorityFromTitle('Senior Software Engineer')).toBe('senior');
    });

    it('detects "Sr." in title', () => {
      expect(inferSeniorityFromTitle('Sr. Backend Engineer')).toBe('senior');
    });

    it('detects "Sr" without dot', () => {
      expect(inferSeniorityFromTitle('Sr Software Engineer')).toBe('senior');
    });
  });

  describe('junior detection', () => {
    it('detects "Junior" in title', () => {
      expect(inferSeniorityFromTitle('Junior Developer')).toBe('junior');
    });

    it('detects "Jr." in title', () => {
      expect(inferSeniorityFromTitle('Jr. Software Engineer')).toBe('junior');
    });

    it('detects "New Grad" in title', () => {
      expect(inferSeniorityFromTitle('Software Engineer, New Grad')).toBe('junior');
    });

    it('detects "Entry Level" in title', () => {
      expect(inferSeniorityFromTitle('Entry Level Backend Developer')).toBe('junior');
    });

    it('detects "Entry-Level" with hyphen', () => {
      expect(inferSeniorityFromTitle('Entry-Level Engineer')).toBe('junior');
    });

    it('detects "Intern" in title', () => {
      expect(inferSeniorityFromTitle('Software Engineer Intern')).toBe('junior');
    });
  });

  describe('priority ordering', () => {
    it('staff takes precedence over senior', () => {
      expect(inferSeniorityFromTitle('Staff Senior Engineer')).toBe('staff');
    });

    it('lead takes precedence over senior', () => {
      expect(inferSeniorityFromTitle('Lead Senior Engineer')).toBe('lead');
    });
  });

  describe('no match', () => {
    it('returns null for ambiguous titles', () => {
      expect(inferSeniorityFromTitle('Software Engineer')).toBeNull();
    });

    it('returns null for "Mid" (not a keyword)', () => {
      expect(inferSeniorityFromTitle('Mid-Level Software Engineer')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(inferSeniorityFromTitle('')).toBeNull();
    });
  });

  describe('word boundary matching', () => {
    it('does not match "internal" as "intern"', () => {
      expect(inferSeniorityFromTitle('Internal Tools Engineer')).toBeNull();
    });

    it('does not match "leading" as "lead"', () => {
      expect(inferSeniorityFromTitle('Industry-Leading Platform Engineer')).toBeNull();
    });
  });
});
