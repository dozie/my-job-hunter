/**
 * One-time script to retroactively flag cross-provider duplicates
 * using Jaccard word similarity on jobs with the same company+title.
 *
 * Usage: tsx scripts/dedup-existing.ts
 */
import { eq, ne, and, isNull, sql } from 'drizzle-orm';
import { db, queryClient } from '../src/db/client.js';
import { jobs } from '../src/db/schema.js';
import { jaccardSimilarity } from '../src/ingestion/normalizer.js';
import { logger } from '../src/observability/logger.js';

const log = logger.child({ module: 'dedup-existing' });

const SIMILARITY_THRESHOLD = 0.8;

async function run() {
  log.info('Starting retroactive dedup scan');

  // Find all distinct canonical key prefixes (company::title::) that have multiple jobs
  const groups = await db.execute<{ prefix: string; cnt: string }>(sql`
    SELECT
      substring(canonical_key FROM '^[^:]+::[^:]+::') AS prefix,
      count(*) AS cnt
    FROM jobs
    WHERE canonical_key IS NOT NULL
      AND likely_duplicate_of_id IS NULL
      AND is_stale = false
    GROUP BY prefix
    HAVING count(*) > 1
    ORDER BY prefix
  `);

  let totalChecked = 0;
  let totalFlagged = 0;

  for (const group of groups) {
    const prefix = group.prefix;
    if (!prefix) continue;

    // Get all jobs in this group, ordered by id (older first = primary)
    const groupJobs = await db
      .select({ id: jobs.id, provider: jobs.provider, description: jobs.description, title: jobs.title, company: jobs.company })
      .from(jobs)
      .where(
        and(
          sql`${jobs.canonicalKey} LIKE ${prefix + '%'}`,
          isNull(jobs.likelyDuplicateOfId),
          eq(jobs.isStale, false),
        ),
      )
      .orderBy(jobs.id);

    if (groupJobs.length < 2) continue;

    const primary = groupJobs[0];
    totalChecked++;

    for (let i = 1; i < groupJobs.length; i++) {
      const candidate = groupJobs[i];
      const bothMissingDesc = !primary.description && !candidate.description;
      const similarity = (primary.description && candidate.description)
        ? jaccardSimilarity(primary.description, candidate.description)
        : 0;

      if (bothMissingDesc || similarity >= SIMILARITY_THRESHOLD) {
        await db
          .update(jobs)
          .set({ likelyDuplicateOfId: primary.id })
          .where(eq(jobs.id, candidate.id));

        totalFlagged++;
        log.info(
          {
            duplicateId: candidate.id,
            primaryId: primary.id,
            similarity: bothMissingDesc ? 'no-desc' : similarity.toFixed(2),
            company: candidate.company,
            title: candidate.title,
          },
          'Flagged existing duplicate',
        );
      } else {
        log.warn(
          {
            candidateId: candidate.id,
            primaryId: primary.id,
            score: similarity.toFixed(2),
            company: candidate.company,
            title: candidate.title,
          },
          'Same company+title but low similarity — kept separate',
        );
      }
    }
  }

  log.info({ totalChecked, totalFlagged }, 'Retroactive dedup scan complete');

  // Close the database connection
  await queryClient.end();
}

run().catch((err) => {
  log.error({ err }, 'Dedup script failed');
  process.exit(1);
});
