import { eq, ne, and, lt, isNull, sql } from 'drizzle-orm';
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
import { CoresignalProvider } from './providers/coresignal.js';
import { BrightDataProvider } from './providers/brightdata.js';
import { SerpApiProvider } from './providers/serpapi.js';
import type { ExistingJobChecker, MonthlyUsageChecker, SerpApiConfig } from './providers/serpapi.js';
import { env } from '../config/env.js';
import { passesRoleFilter, passesLocationFilter } from './filters.js';
import { normalizeJobs, normalizeCompany, normalizeTitle } from './normalizer.js';
import { analyzeJob } from '../scoring/analyzer.js';
import { scoreJob } from '../scoring/scorer.js';
import { shouldGenerateSummary, generateSummary } from '../scoring/summarizer.js';
import { logger } from '../observability/logger.js';

const log = logger.child({ module: 'orchestrator' });

const SCORING_CONCURRENCY = 5;
const STALE_DAYS = 30;

/**
 * Determine SerpApi crawl depth based on time of day.
 * Morning: deep (3 pages), midday: medium (2), evening: shallow (1).
 */
function getSerpApiDepth(): number {
  const hour = new Date().getHours();
  if (hour < 9) return 3;   // Morning: pages 1-2-3
  if (hour < 15) return 2;  // Midday: pages 1-2
  return 1;                  // Evening: page 1 only
}

/** Check how many SerpApi searches have been logged this month. */
const checkSerpApiMonthlyUsage: MonthlyUsageChecker = async () => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(ingestionLogs)
    .where(
      and(
        eq(ingestionLogs.provider, 'serpapi'),
        sql`${ingestionLogs.ranAt} >= ${startOfMonth}`,
      ),
    );

  return Number(result[0]?.count ?? 0);
};

/** Check how many of the given externalIds already exist for SerpApi. */
const checkSerpApiExisting: ExistingJobChecker = async (ids: string[]) => {
  if (ids.length === 0) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(
        eq(jobs.provider, 'serpapi'),
        sql`${jobs.externalId} = ANY(${ids})`,
      ),
    );

  return Number(result[0]?.count ?? 0);
};

const PROVIDER_TIERS: string[][] = [
  ['coresignal'],
  ['brightdata'],
  ['greenhouse', 'ashby', 'adzuna', 'remotive'],
  ['serpapi'],  // Tier 4: aggregator, runs last for best dedup
];

export interface IngestionResult {
  provider: string;
  fetched: number;
  afterRoleFilter: number;
  afterLocationFilter: number;
  inserted: number;
  duplicates: number;
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
  if (config.coresignal.enabled && config.coresignal.boards.length > 0) {
    if (env.CORESIGNAL_API_KEY) {
      providers.push(new CoresignalProvider(config.coresignal.boards, env.CORESIGNAL_API_KEY));
    } else {
      log.warn('Coresignal enabled but CORESIGNAL_API_KEY not set — skipping');
    }
  }
  if (config.brightdata.enabled && config.brightdata.boards.length > 0) {
    if (env.BRIGHTDATA_API_TOKEN) {
      providers.push(new BrightDataProvider(config.brightdata.boards, env.BRIGHTDATA_API_TOKEN));
    } else {
      log.warn('Bright Data enabled but BRIGHTDATA_API_TOKEN not set — skipping');
    }
  }
  if (config.serpapi.enabled && config.serpapi.boards.length > 0) {
    if (env.SERPAPI_API_KEY) {
      const depth = getSerpApiDepth();
      const serpApiConfig: SerpApiConfig = {
        maxPages: config.serpapi.maxPages,
        monthlyBudget: config.serpapi.monthlyBudget,
      };
      log.info({ serpApiDepth: depth, ...serpApiConfig }, 'SerpApi depth determined by time of day');
      providers.push(new SerpApiProvider(
        config.serpapi.boards,
        env.SERPAPI_API_KEY,
        serpApiConfig,
        depth,
        checkSerpApiExisting,
        checkSerpApiMonthlyUsage,
      ));
    } else {
      log.warn('SerpApi enabled but SERPAPI_API_KEY not set — skipping');
    }
  }

  return providers;
}

interface InsertResult {
  inserted: NewJob[];
  duplicatesFound: number;
}

async function insertNewJobs(normalized: NewJob[]): Promise<InsertResult> {
  if (normalized.length === 0) return { inserted: [], duplicatesFound: 0 };

  const inserted: NewJob[] = [];
  let duplicatesFound = 0;

  for (const job of normalized) {
    try {
      const result = await db
        .insert(jobs)
        .values(job)
        .onConflictDoNothing({ target: [jobs.externalId, jobs.provider] })
        .returning();

      if (result.length > 0) {
        if (job.canonicalKey) {
          const existing = await db
            .select({ id: jobs.id, provider: jobs.provider })
            .from(jobs)
            .where(
              and(
                eq(jobs.canonicalKey, job.canonicalKey),
                ne(jobs.id, result[0].id),
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            await db
              .update(jobs)
              .set({ likelyDuplicateOfId: existing[0].id })
              .where(eq(jobs.id, result[0].id));

            duplicatesFound++;
            log.info(
              {
                duplicateId: result[0].id,
                primaryId: existing[0].id,
                primaryProvider: existing[0].provider,
                provider: job.provider,
                company: job.company,
                title: job.title,
                canonicalKey: job.canonicalKey,
              },
              'Likely duplicate found — flagged',
            );
          } else {
            const companyTitlePrefix = `${normalizeCompany(job.company!)}::${normalizeTitle(job.title!)}::`;
            const sameTitle = await db
              .select({ id: jobs.id, provider: jobs.provider })
              .from(jobs)
              .where(
                and(
                  sql`${jobs.canonicalKey} LIKE ${companyTitlePrefix + '%'}`,
                  ne(jobs.id, result[0].id),
                ),
              )
              .limit(1);

            if (sameTitle.length > 0) {
              log.warn(
                {
                  newId: result[0].id,
                  existingId: sameTitle[0].id,
                  existingProvider: sameTitle[0].provider,
                  provider: job.provider,
                  company: job.company,
                  title: job.title,
                },
                'Same company+title but different description — kept as separate job',
              );
            }
          }
        }

        inserted.push(job);
      } else {
        // Re-encountered job — refresh fields and updatedAt for stale tracking
        await db.update(jobs)
          .set({
            updatedAt: new Date(),
            description: job.description,
            compensation: job.compensation,
            location: job.location,
          })
          .where(and(
            eq(jobs.externalId, job.externalId!),
            eq(jobs.provider, job.provider),
          ));
      }
    } catch (err) {
      log.error({ err, externalId: job.externalId }, 'Failed to insert job');
    }
  }

  if (duplicatesFound > 0) {
    log.info({ duplicatesFound }, 'Cross-provider duplicates flagged in this batch');
  }

  return { inserted, duplicatesFound };
}

async function scoreNewJobs(newJobs: NewJob[]): Promise<number> {
  if (newJobs.length === 0) return 0;

  const limit = pLimit(SCORING_CONCURRENCY);
  let scored = 0;

  const tasks = newJobs.map(job =>
    limit(async () => {
      try {
        if (job.likelyDuplicateOfId) {
          log.debug({ externalId: job.externalId }, 'Skipping scoring — likely duplicate');
          return;
        }

        if (!job.description) {
          log.debug({ externalId: job.externalId }, 'Skipping scoring — no description');
          return;
        }

        const metadata = await analyzeJob(job.title, job.description, job.location ?? undefined);
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
            summary,
            ...(metadata.fromDefaults ? {} : { remoteEligible: metadata.remote_eligible }),
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
    .where(and(eq(jobs.isStale, false), lt(jobs.updatedAt, cutoff)))
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
    duplicates: 0,
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
    const normalized = normalizeJobs(locationFiltered, provider.name, config.filters.remote_indicators);

    // 5. Insert (deduplicate via ON CONFLICT) + cross-provider soft dedup
    const { inserted, duplicatesFound } = await insertNewJobs(normalized);
    result.inserted = inserted.length;
    result.duplicates = duplicatesFound;
    log.info(
      { provider: provider.name, new: inserted.length, duplicates: duplicatesFound, total: normalized.length },
      'Jobs inserted',
    );

    // 6. Score new jobs (duplicates skipped inside scoreNewJobs)
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

  // Run providers in priority tiers: sequential between tiers, parallel within
  const results: IngestionResult[] = [];

  for (const tierNames of PROVIDER_TIERS) {
    const tierProviders = providers.filter(p => tierNames.includes(p.name));
    if (tierProviders.length === 0) continue;

    log.info({ tier: tierNames, count: tierProviders.length }, 'Starting provider tier');

    const settled = await Promise.allSettled(
      tierProviders.map(p => runProviderIngestion(p)),
    );

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        results.push(s.value);
      } else {
        log.error({ err: s.reason }, 'Provider ingestion rejected');
      }
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
        duplicates: r.duplicates,
        scored: r.scored,
        error: r.error,
      })),
    },
    'Ingestion run complete',
  );

  return { results, staleMarked, totalNew };
}
