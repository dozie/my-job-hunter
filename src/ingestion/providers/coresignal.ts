import pLimit from 'p-limit';
import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:coresignal' });

const BASE_URL = 'https://api.coresignal.com/cdapi/v2/job_base';
const COLLECT_CONCURRENCY = 10;
const DEFAULT_MAX_COLLECT = 50;
const FRESHNESS_DAYS = 7;

const COLLECT_FIELDS = [
  'professional_network_job_id',
  'title',
  'description',
  'location',
  'country',
  'employment_type',
  'seniority',
  'url',
  'salary',
  'company',
  'application_active',
  'deleted',
];

interface CoresignalSalary {
  min?: number;
  max?: number;
  currency?: string;
  unit?: string;
}

interface CoresignalCompany {
  name?: string;
  website?: string;
}

interface CoresignalJob {
  professional_network_job_id: number;
  title: string;
  description: string;
  location: string;
  country: string;
  employment_type: string;
  seniority: string;
  url: string;
  salary?: CoresignalSalary;
  company?: CoresignalCompany;
  application_active?: number;
  deleted?: number;
}

export class CoresignalProvider implements JobProvider {
  readonly name = 'coresignal';
  private boards: Board[];
  private apiKey: string;

  constructor(boards: Board[], apiKey: string) {
    this.boards = boards;
    this.apiKey = apiKey;
  }

  async fetchJobs(): Promise<RawJob[]> {
    const results = await Promise.allSettled(
      this.boards.map(board => this.fetchBoard(board)),
    );

    const allJobs: RawJob[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allJobs.push(...result.value);
      } else {
        log.error({ err: result.reason }, 'Board fetch failed');
      }
    }

    log.info({ total: allJobs.length, boards: this.boards.length }, 'Coresignal fetch complete');
    return allJobs;
  }

  private async fetchBoard(board: Board): Promise<RawJob[]> {
    const ids = await this.searchJobIds(board);

    if (ids.length === 0) {
      log.debug({ board: board.name }, 'No job IDs found');
      return [];
    }

    log.info(
      { board: board.name, idCount: ids.length, maxCollect: board.maxCollect ?? DEFAULT_MAX_COLLECT },
      'Collecting job records',
    );

    const coresignalJobs = await this.collectJobs(ids);

    return coresignalJobs
      .filter(job => job.application_active !== 0 && job.deleted !== 1)
      .map((job): RawJob => ({
        externalId: String(job.professional_network_job_id),
        title: job.title,
        company: job.company?.name || board.label || board.name,
        link: job.url,
        description: job.description,
        location: job.location,
        seniority: job.seniority,
        compensation: this.formatSalary(job.salary),
        metadata: {
          country: job.country,
          employmentType: job.employment_type,
          companyWebsite: job.company?.website,
        },
      }));
  }

  private async searchJobIds(board: Board): Promise<number[]> {
    const maxCollect = board.maxCollect ?? DEFAULT_MAX_COLLECT;
    const ids: number[] = [];
    let afterCursor: string | undefined;

    const body: Record<string, unknown> = {
      application_active: 1,
      deleted: 0,
    };
    if (board.country) body.country = board.country;
    if (board.employmentType) body.employment_type = board.employmentType;
    if (board.keywords) body.title = board.keywords;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - FRESHNESS_DAYS);
    body.last_updated_gte = cutoff.toISOString().replace('T', ' ').slice(0, 19);

    while (ids.length < maxCollect) {
      const url = new URL(`${BASE_URL}/search/filter`);
      if (afterCursor) {
        url.searchParams.set('after', afterCursor);
      }

      log.info({ method: 'POST', url: url.pathname, board: board.name, collected: ids.length, cursor: afterCursor }, 'API request (search)');
      const startTime = Date.now();

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'apikey': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        log.info({ status: response.status, durationMs, board: board.name }, 'API response (search)');
        throw new Error(`Coresignal search ${board.name}: HTTP ${response.status}`);
      }

      const pageIds = (await response.json()) as number[];
      log.info({ status: response.status, durationMs, board: board.name, pageIds: pageIds.length }, 'API response (search)');

      if (pageIds.length === 0) break;

      const remaining = maxCollect - ids.length;
      ids.push(...pageIds.slice(0, remaining));

      const nextCursor = response.headers.get('x-next-page-after');
      if (!nextCursor || ids.length >= maxCollect) break;
      afterCursor = nextCursor;
    }

    log.debug({ board: board.name, totalIds: ids.length }, 'Search complete');
    return ids;
  }

  private async collectJobs(ids: number[]): Promise<CoresignalJob[]> {
    const limit = pLimit(COLLECT_CONCURRENCY);
    const fieldsParam = COLLECT_FIELDS.join(',');

    log.info({ method: 'GET', ids: ids.length, concurrency: COLLECT_CONCURRENCY }, 'API request (collect batch)');
    const batchStart = Date.now();

    const tasks = ids.map(id =>
      limit(async () => {
        const url = `${BASE_URL}/collect/${id}?fields=${fieldsParam}`;
        const startTime = Date.now();
        const response = await fetch(url, {
          headers: { 'apikey': this.apiKey },
        });
        const durationMs = Date.now() - startTime;

        if (!response.ok) {
          log.warn({ id, status: response.status, durationMs }, 'Collect failed for job ID');
          return null;
        }

        log.debug({ id, status: response.status, durationMs }, 'API response (collect)');
        return (await response.json()) as CoresignalJob;
      }),
    );

    const results = await Promise.allSettled(tasks);
    const jobs: CoresignalJob[] = [];
    let failed = 0;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        jobs.push(result.value);
      } else if (result.status === 'rejected') {
        failed++;
        log.warn({ err: result.reason }, 'Collect request rejected');
      } else {
        failed++;
      }
    }

    log.info({ collected: jobs.length, failed, durationMs: Date.now() - batchStart }, 'API response (collect batch)');
    return jobs;
  }

  private formatSalary(salary?: CoresignalSalary): string | undefined {
    if (!salary) return undefined;
    const { min, max, currency, unit } = salary;
    const parts: string[] = [];
    if (min && max) {
      parts.push(`${min.toLocaleString()} – ${max.toLocaleString()}`);
    } else if (min) {
      parts.push(`From ${min.toLocaleString()}`);
    } else if (max) {
      parts.push(`Up to ${max.toLocaleString()}`);
    } else {
      return undefined;
    }
    if (currency) parts.push(currency);
    if (unit) parts.push(`per ${unit.toLowerCase()}`);
    return parts.join(' ');
  }
}
