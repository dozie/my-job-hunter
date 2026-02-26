import pLimit from 'p-limit';
import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:brightdata' });

const BASE_URL = 'https://api.brightdata.com/datasets/v3';

const DATASET_IDS: Record<string, string> = {
  linkedin: 'gd_lpfll7v5hcqtkxl6l',
  indeed: 'gd_l4dx9j9sscpvs7no2',
  glassdoor: 'gd_lpfbbndm1xnopbrcr0',
};

const BOARD_CONCURRENCY = 3;
const DEFAULT_MAX_RECORDS = 100;
const POLL_INITIAL_INTERVAL_MS = 15_000;
const POLL_MAX_INTERVAL_MS = 60_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

interface TriggerResponse {
  snapshot_id: string;
}

interface ProgressResponse {
  snapshot_id: string;
  dataset_id: string;
  status: 'starting' | 'running' | 'ready' | 'failed';
}

interface LinkedInJob {
  job_posting_id?: string;
  job_title: string;
  company_name?: string;
  job_location?: string;
  job_description_formatted?: string;
  job_summary?: string;
  job_seniority_level?: string;
  job_employment_type?: string;
  job_base_pay_range?: string;
  base_salary?: number;
  apply_link?: string;
  url?: string;
  country_code?: string;
  job_posted_date?: string;
  job_industries?: string;
  job_function?: string;
}

interface IndeedJob {
  jobid?: string;
  job_title: string;
  company_name?: string;
  location?: string;
  description_text?: string;
  job_type?: string;
  salary?: string;
  date_posted_parsed?: string;
  url?: string;
  benefits?: string[];
  qualifications?: string;
}

interface GlassdoorJob {
  url?: string;
  job_title: string;
  company_name?: string;
  job_location?: string;
  job_overview?: string;
  company_rating?: number;
}

export class BrightDataProvider implements JobProvider {
  readonly name = 'brightdata';
  private boards: Board[];
  private apiToken: string;

  constructor(boards: Board[], apiToken: string) {
    this.boards = boards;
    this.apiToken = apiToken;
  }

  async fetchJobs(): Promise<RawJob[]> {
    const limit = pLimit(BOARD_CONCURRENCY);

    const results = await Promise.allSettled(
      this.boards.map(board => limit(() => this.fetchBoard(board))),
    );

    const allJobs: RawJob[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allJobs.push(...result.value);
      } else {
        log.error({ err: result.reason }, 'Board fetch failed');
      }
    }

    log.info({ total: allJobs.length, boards: this.boards.length }, 'Bright Data fetch complete');
    return allJobs;
  }

  private async fetchBoard(board: Board): Promise<RawJob[]> {
    const source = (board.category || 'linkedin').toLowerCase();
    const datasetId = DATASET_IDS[source];
    if (!datasetId) {
      log.warn({ board: board.name, source }, 'Unknown source — skipping');
      return [];
    }

    const snapshotId = await this.triggerSnapshot(board, datasetId, source);
    await this.pollUntilReady(snapshotId, board.name);
    const rawData = await this.downloadSnapshot(snapshotId, board.name);

    return this.mapJobs(rawData, source, board);
  }

  private async triggerSnapshot(
    board: Board,
    datasetId: string,
    source: string,
  ): Promise<string> {
    const maxRecords = board.maxCollect ?? DEFAULT_MAX_RECORDS;

    const url = new URL(`${BASE_URL}/trigger`);
    url.searchParams.set('dataset_id', datasetId);
    url.searchParams.set('type', 'discover_new');
    url.searchParams.set('discover_by', 'keyword');
    url.searchParams.set('limit_per_input', String(maxRecords));
    url.searchParams.set('include_errors', 'true');
    url.searchParams.set('format', 'json');

    const input = this.buildInput(board, source);

    log.info(
      { board: board.name, source, maxRecords, datasetId },
      'Triggering Bright Data snapshot',
    );

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([input]),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Bright Data trigger ${board.name}: HTTP ${response.status} — ${text}`,
      );
    }

    const data = (await response.json()) as TriggerResponse;
    log.debug(
      { board: board.name, snapshotId: data.snapshot_id },
      'Snapshot triggered',
    );
    return data.snapshot_id;
  }

  private buildInput(board: Board, source: string): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    if (board.keywords) input.keyword = board.keywords;
    if (board.country) {
      input.country = board.country;
      input.location = board.country;
    }

    if (source === 'linkedin') {
      if (board.employmentType) input.job_type = board.employmentType;
    } else if (source === 'indeed') {
      if (board.employmentType) input.job_type = board.employmentType;
    } else if (source === 'glassdoor') {
      input.days = 7;
    }

    return input;
  }

  private async pollUntilReady(snapshotId: string, boardName: string): Promise<void> {
    const startTime = Date.now();
    let interval = POLL_INITIAL_INTERVAL_MS;

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= POLL_TIMEOUT_MS) {
        throw new Error(
          `Bright Data snapshot ${snapshotId} timed out after ${POLL_TIMEOUT_MS / 1000}s for board "${boardName}"`,
        );
      }

      await this.delay(interval);

      const url = `${BASE_URL}/progress/${snapshotId}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
      });

      if (!response.ok) {
        throw new Error(
          `Bright Data progress ${snapshotId}: HTTP ${response.status}`,
        );
      }

      const data = (await response.json()) as ProgressResponse;

      log.debug(
        { board: boardName, snapshotId, status: data.status, elapsedMs: elapsed },
        'Polling snapshot progress',
      );

      if (data.status === 'ready') return;

      if (data.status === 'failed') {
        throw new Error(
          `Bright Data snapshot ${snapshotId} failed for board "${boardName}"`,
        );
      }

      interval = Math.min(interval + POLL_INITIAL_INTERVAL_MS, POLL_MAX_INTERVAL_MS);
    }
  }

  private async downloadSnapshot(snapshotId: string, boardName: string): Promise<unknown[]> {
    const url = `${BASE_URL}/snapshot/${snapshotId}?format=json`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.apiToken}` },
    });

    if (!response.ok) {
      throw new Error(
        `Bright Data download ${snapshotId}: HTTP ${response.status}`,
      );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      log.warn({ snapshotId, type: typeof data }, 'Unexpected snapshot format');
      return [];
    }

    log.info(
      { board: boardName, records: data.length, estimatedCost: `$${(data.length * 0.0015).toFixed(4)}` },
      'Snapshot downloaded',
    );

    return data as unknown[];
  }

  private mapJobs(rawData: unknown[], source: string, board: Board): RawJob[] {
    switch (source) {
      case 'linkedin':
        return (rawData as LinkedInJob[]).map(job => this.mapLinkedInJob(job, board));
      case 'indeed':
        return (rawData as IndeedJob[]).map(job => this.mapIndeedJob(job, board));
      case 'glassdoor':
        return (rawData as GlassdoorJob[]).map(job => this.mapGlassdoorJob(job, board));
      default:
        return [];
    }
  }

  private mapLinkedInJob(job: LinkedInJob, board: Board): RawJob {
    return {
      externalId: job.job_posting_id || job.apply_link || job.url || '',
      title: job.job_title,
      company: job.company_name || board.label || board.name,
      link: job.apply_link || job.url || '',
      description: job.job_description_formatted || job.job_summary,
      location: job.job_location,
      seniority: job.job_seniority_level,
      compensation: this.formatLinkedInSalary(job),
      remoteEligible: this.detectRemoteFromLocation(job.job_location),
      metadata: {
        source: 'linkedin',
        employmentType: job.job_employment_type,
        industries: job.job_industries,
        jobFunction: job.job_function,
        postedDate: job.job_posted_date,
        countryCode: job.country_code,
      },
    };
  }

  private mapIndeedJob(job: IndeedJob, board: Board): RawJob {
    return {
      externalId: job.jobid || job.url || '',
      title: job.job_title,
      company: job.company_name || board.label || board.name,
      link: job.url || '',
      description: job.description_text,
      location: job.location,
      compensation: job.salary,
      metadata: {
        source: 'indeed',
        jobType: job.job_type,
        postedDate: job.date_posted_parsed,
        benefits: job.benefits,
        qualifications: job.qualifications,
      },
    };
  }

  private mapGlassdoorJob(job: GlassdoorJob, board: Board): RawJob {
    return {
      externalId: job.url || '',
      title: job.job_title,
      company: job.company_name || board.label || board.name,
      link: job.url || '',
      description: job.job_overview,
      location: job.job_location,
      metadata: {
        source: 'glassdoor',
        companyRating: job.company_rating,
      },
    };
  }

  private formatLinkedInSalary(job: LinkedInJob): string | undefined {
    if (job.job_base_pay_range) return job.job_base_pay_range;
    if (job.base_salary) return `$${job.base_salary.toLocaleString()}`;
    return undefined;
  }

  private detectRemoteFromLocation(location?: string): boolean | undefined {
    if (!location) return undefined;
    const lower = location.toLowerCase();
    return lower.includes('remote') || lower.includes('anywhere') ? true : undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
