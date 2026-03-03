import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:ashby' });

interface AshbyJob {
  id: string;
  title: string;
  location: string;
  descriptionHtml: string;
  jobUrl: string;
  publishedAt: string;
  compensation?: {
    compensationTierSummary?: string;
  };
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

export class AshbyProvider implements JobProvider {
  readonly name = 'ashby';
  private boards: Board[];

  constructor(boards: Board[]) {
    this.boards = boards;
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

    log.info({ total: allJobs.length, boards: this.boards.length }, 'Ashby fetch complete');
    return allJobs;
  }

  private async fetchBoard(board: Board): Promise<RawJob[]> {
    const name = board.name;
    const url = `https://api.ashbyhq.com/posting-api/job-board/${name}?includeCompensation=true`;

    log.info({ method: 'GET', url, board: board.label || name }, 'API request');
    const startTime = Date.now();
    const response = await fetch(url);
    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      log.info({ status: response.status, durationMs, board: board.label || name }, 'API response');
      throw new Error(`Ashby ${name}: HTTP ${response.status}`);
    }

    const data = (await response.json()) as AshbyResponse;
    log.info({ status: response.status, durationMs, board: board.label || name, jobs: data.jobs.length }, 'API response');

    return data.jobs.map((job): RawJob => ({
      externalId: job.id,
      title: job.title,
      company: board.label || board.name,
      link: job.jobUrl,
      description: job.descriptionHtml,
      location: job.location,
      compensation: job.compensation?.compensationTierSummary,
    }));
  }
}
