import { loadScoringConfig } from '../config/scoring.js';
import type { JobMetadata } from './analyzer.js';

export interface ScoreResult {
  score: number;
  breakdown: Record<string, number>;
}

const CANADA_KEYWORDS = [
  'toronto', 'canada', 'canadian', 'vancouver', 'montreal', 'ottawa',
];

const US_KEYWORDS = [
  'us', 'usa', 'united states', 'new york', 'san francisco',
  'seattle', 'austin', 'boston', 'chicago', 'denver',
];

function getEmployerLocationFactor(location?: string): number {
  if (!location) return 0.5;
  const lower = location.toLowerCase();
  for (const kw of CANADA_KEYWORDS) {
    if (lower.includes(kw)) return 1.0;
  }
  for (const kw of US_KEYWORDS) {
    if (lower.includes(kw)) return 0.5;
  }
  return 0.0;
}

export function scoreJob(
  metadata: JobMetadata,
  location?: string,
): ScoreResult {
  const config = loadScoringConfig();
  const { weights } = config;

  const remoteFactor = metadata.remote_eligible ? 1.0 : 0.0;
  const seniorityFactor = config.target_seniority.includes(metadata.seniority)
    ? 1.0
    : ['lead', 'staff'].includes(metadata.seniority)
      ? 0.3
      : 0.0;
  const employerFactor = getEmployerLocationFactor(location);
  const interviewFactor = config.interview_preferences[metadata.interview_style] ?? 0.5;
  const roleTypeFactor = config.role_type_preferences[metadata.role_type] ?? 0.5;

  const breakdown: Record<string, number> = {
    remote: +(remoteFactor * weights.remote_eligible).toFixed(2),
    seniority: +(seniorityFactor * weights.seniority_match).toFixed(2),
    employer_location: +(employerFactor * weights.employer_location).toFixed(2),
    interview_style: +(interviewFactor * weights.interview_style).toFixed(2),
    role_type: +(roleTypeFactor * weights.role_type).toFixed(2),
  };

  const rawScore = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const maxPossible = Object.values(weights).reduce((sum, v) => sum + v, 0);
  const finalScore = +((rawScore / maxPossible) * 10).toFixed(2);

  return { score: finalScore, breakdown };
}
