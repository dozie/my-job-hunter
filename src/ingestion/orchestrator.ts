import { eq, and, lt, sql } from 'drizzle-orm';
import pLimit from 'p-limit';
import { db } from '../db/client.js';
import { jobs, ingestionLogs } from '../db/schema.js';
import type { NewJob } from '../db/schema.js';
import { loadProvidersConfig } from '../config/providers.js';
import type { JobProvider, RawJob } from './providers/base.js';
import { GreenhouseProvider } from './providers/greenhouse.js';
import { AshbyProvider } from './providers/ashby.js';
import { AdzunaProvider } from './providers/adzuna.js';
import { RemotiveProvider } from './providers/remotive.js';
import { env } from '../config/env.js';
import { passesRoleFilter, passesLocationFilter } from './filters.js';
import { normalizeJobs } from './normalizer.js';
import { analyzeJob } from '../scoring/analyzer.js';
import { scoreJob } from '../scoring/scorer.js';
import { shouldGenerateSummary, generateSummary } from '../scoring/summarizer.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'orchestrator' });

const SCORING_CONCURRENCY = 5;
const STALE_DAYS = 30;

export interface IngestionResult {
  provider: string;
  fetched: number;
  afterRoleFilter: number;
  afterLocationFilter: number;
  inserted: number;
  scored: number;
  error?: string;
}

export interface IngestionSummary {
  results: IngestionResult[];
  staleMarked: number;
  totalNew: number;
}

function buildProviders(): JobProvider[] {
  const config = loadProvidersConfig();
  const providers: JobProvider[] = [];

  if (config.greenhouse.enabled && config.greenhouse.boards.length > 0) {
    providers.push(new GreenhouseProvider(config.greenhouse.boards));
  }
  if (config.ashby.enabled && config.ashby.boards.length > 0) {
    providers.push(new AshbyProvider(config.ashby.boards));
  }
  if (config.adzuna.enabled && config.adzuna.boards.length > 0) {
    if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) {
      providers.push(new AdzunaProvider(config.adzuna.boards, env.ADZUNA_APP_ID, env.ADZUNA_APP_KEY));
    } else {
      log.warn('Adzuna enabled but ADZUNA_APP_ID/ADZUNA_APP_KEY not set — skipping');
    }
  }
  if (config.remotive.enabled && config.remotive.boards.length > 0) {
    providers.push(new RemotiveProvider(config.remotive.boards));
  }

  return providers;
}

async function insertNewJobs(normalized: NewJob[]): Promise<NewJob[]> {
  if (normalized.length === 0) return [];

  const inserted: NewJob[] = [];

  for (const job of normalized) {
    try {
      const result = await db
        .insert(jobs)
        .values(job)
        .onConflictDoNothing({ target: [jobs.externalId, jobs.provider] })
        .returning();

      if (result.length > 0) {
        inserted.push(job);
      }
    } catch (err) {
      log.error({ err, externalId: job.externalId }, 'Failed to insert job');
    }
  }

  return inserted;
}

async function scoreNewJobs(newJobs: NewJob[]): Promise<number> {
  if (newJobs.length === 0) return 0;

  const limit = pLimit(SCORING_CONCURRENCY);
  let scored = 0;

  const tasks = newJobs.map(job =>
    limit(async () => {
      try {
        if (!job.description) {
          log.debug({ externalId: job.externalId }, 'Skipping scoring — no description');
          return;
        }

        const metadata = await analyzeJob(job.title, job.description);
        const result = scoreJob(metadata, job.location ?? undefined);

        // Generate Sonnet summary only for high-scoring jobs (cost optimization)
        let summary: string | null = null;
        if (shouldGenerateSummary(result.score)) {
          summary = await generateSummary(job.title, job.description, metadata);
        }

        await db
          .update(jobs)
          .set({
            seniority: metadata.seniority,
            interviewStyle: metadata.interview_style,
            score: String(result.score),
            scoreBreakdown: result.breakdown,
            remoteEligible: metadata.remote_eligible,
            summary,
          })
          .where(
            and(
              eq(jobs.externalId, job.externalId!),
              eq(jobs.provider, job.provider),
            ),
          );

        scored++;
        log.debug(
          { externalId: job.externalId, score: result.score },
          'Job scored',
        );
      } catch (err) {
        log.error({ err, externalId: job.externalId }, 'Scoring failed for job');
      }
    }),
  );

  await Promise.allSettled(tasks);
  return scored;
}

async function markStaleJobs(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);

  const result = await db
    .update(jobs)
    .set({ isStale: true })
    .where(and(eq(jobs.isStale, false), lt(jobs.createdAt, cutoff)))
    .returning({ id: jobs.id });

  return result.length;
}

async function logIngestion(
  provider: string,
  jobsFound: number,
  jobsNew: number,
  error?: string,
): Promise<void> {
  await db.insert(ingestionLogs).values({
    provider,
    jobsFound,
    jobsNew,
    error,
  });
}

async function runProviderIngestion(provider: JobProvider): Promise<IngestionResult> {
  const config = loadProvidersConfig();
  const result: IngestionResult = {
    provider: provider.name,
    fetched: 0,
    afterRoleFilter: 0,
    afterLocationFilter: 0,
    inserted: 0,
    scored: 0,
  };

  try {
    // 1. Fetch raw jobs
    const rawJobs = await provider.fetchJobs();
    result.fetched = rawJobs.length;
    log.info({ provider: provider.name, count: rawJobs.length }, 'Fetched raw jobs');

    // 2. Filter by role
    const roleFiltered = rawJobs.filter(job => passesRoleFilter(job, config.filters));
    result.afterRoleFilter = roleFiltered.length;
    log.info(
      { provider: provider.name, before: rawJobs.length, after: roleFiltered.length },
      'Role filter applied',
    );

    // 3. Filter by location/remote
    const locationFiltered = roleFiltered.filter(job =>
      passesLocationFilter(job, config.filters),
    );
    result.afterLocationFilter = locationFiltered.length;
    log.info(
      { provider: provider.name, before: roleFiltered.length, after: locationFiltered.length },
      'Location filter applied',
    );

    // 4. Normalize
    const normalized = normalizeJobs(locationFiltered, provider.name);

    // 5. Insert (deduplicate via ON CONFLICT)
    const inserted = await insertNewJobs(normalized);
    result.inserted = inserted.length;
    log.info(
      { provider: provider.name, new: inserted.length, total: normalized.length },
      'Jobs inserted',
    );

    // 6. Score new jobs
    result.scored = await scoreNewJobs(inserted);
    log.info(
      { provider: provider.name, scored: result.scored },
      'New jobs scored',
    );

    await logIngestion(provider.name, result.fetched, result.inserted);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.error = errorMsg;
    log.error({ err, provider: provider.name }, 'Provider ingestion failed');
    await logIngestion(provider.name, 0, 0, errorMsg);
  }

  return result;
}

export async function runIngestion(): Promise<IngestionSummary> {
  log.info('Starting ingestion run');
  const providers = buildProviders();

  if (providers.length === 0) {
    log.warn('No providers enabled — skipping ingestion');
    return { results: [], staleMarked: 0, totalNew: 0 };
  }

  // Run all providers in parallel
  const settled = await Promise.allSettled(
    providers.map(p => runProviderIngestion(p)),
  );

  const results: IngestionResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(s.value);
    } else {
      log.error({ err: s.reason }, 'Provider ingestion rejected');
    }
  }

  // Mark stale jobs
  const staleMarked = await markStaleJobs();
  if (staleMarked > 0) {
    log.info({ count: staleMarked }, 'Marked stale jobs');
  }

  const totalNew = results.reduce((sum, r) => sum + r.inserted, 0);

  log.info(
    {
      providers: results.length,
      totalNew,
      staleMarked,
      breakdown: results.map(r => ({
        provider: r.provider,
        fetched: r.fetched,
        inserted: r.inserted,
        scored: r.scored,
        error: r.error,
      })),
    },
    'Ingestion run complete',
  );

  return { results, staleMarked, totalNew };
}
