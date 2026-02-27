import { eq, and, desc, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from './client.js';
import { jobs, applications } from './schema.js';
import type { Job } from './schema.js';

interface QueryJobsOptions {
  limit?: number;
  seniority?: string;
  unexportedOnly?: boolean;
}

const APPLIED_STATUSES = ['applied', 'interviewing', 'offer'];

/**
 * Query jobs with company-interleaved ordering.
 * Uses ROW_NUMBER() OVER (PARTITION BY company ORDER BY score DESC)
 * so the top job from each company appears first, then second-best from each, etc.
 * Excludes jobs that have been applied to, are in interviews, or have an offer.
 */
export async function queryJobsInterleaved(options: QueryJobsOptions = {}): Promise<Job[]> {
  const { limit, seniority, unexportedOnly } = options;

  // IDs of jobs with an active application status
  const appliedJobIds = db
    .select({ jobId: applications.jobId })
    .from(applications)
    .where(notInArray(applications.status, ['not_applied', 'rejected']));

  const conditions: ReturnType<typeof eq>[] = [
    eq(jobs.isStale, false),
    isNull(jobs.likelyDuplicateOfId),
    sql`${jobs.id} NOT IN (${appliedJobIds})`,
  ];
  if (seniority) conditions.push(eq(jobs.seniority, seniority));
  if (unexportedOnly) conditions.push(eq(jobs.exportStatus, 'pending'));

  const ranked = db
    .select({
      id: jobs.id,
      companyRank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${jobs.company} ORDER BY ${jobs.score} DESC)`.as('company_rank'),
    })
    .from(jobs)
    .where(and(...conditions))
    .as('ranked');

  const baseQuery = db
    .select()
    .from(jobs)
    .innerJoin(ranked, eq(jobs.id, ranked.id))
    .orderBy(ranked.companyRank, desc(jobs.score));

  const rows = limit
    ? await baseQuery.limit(limit)
    : await baseQuery;

  return rows.map(r => r.jobs);
}
