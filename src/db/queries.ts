import { eq, and, desc, isNull, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from './client.js';
import { jobs, applications } from './schema.js';
import type { Job } from './schema.js';

interface QueryJobsOptions {
  limit?: number;
  seniority?: string;
  unexportedOnly?: boolean;
  appliedFilter?: 'unapplied' | 'applied';
}

/**
 * Query jobs with company-interleaved ordering.
 * Uses ROW_NUMBER() OVER (PARTITION BY company ORDER BY score DESC)
 * so the top job from each company appears first, then second-best from each, etc.
 *
 * appliedFilter (default: 'unapplied'):
 *   - 'unapplied': exclude applied, interviewing, offer, rejected, skipped
 *   - 'applied': show only applied, interviewing, offer, rejected (not skipped)
 */
export async function queryJobsInterleaved(options: QueryJobsOptions = {}): Promise<Job[]> {
  const { limit, seniority, unexportedOnly, appliedFilter = 'unapplied' } = options;

  const conditions: ReturnType<typeof eq>[] = [
    eq(jobs.isStale, false),
    isNull(jobs.likelyDuplicateOfId),
  ];

  if (appliedFilter === 'applied') {
    const appliedJobIds = db
      .select({ jobId: applications.jobId })
      .from(applications)
      .where(inArray(applications.status, ['applied', 'interviewing', 'offer', 'rejected']));
    conditions.push(sql`${jobs.id} IN (${appliedJobIds})`);
  } else {
    const excludedJobIds = db
      .select({ jobId: applications.jobId })
      .from(applications)
      .where(notInArray(applications.status, ['not_applied']));
    conditions.push(sql`${jobs.id} NOT IN (${excludedJobIds})`);
  }

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
