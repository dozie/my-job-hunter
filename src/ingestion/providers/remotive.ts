import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:remotive' });

const RATE_LIMIT_DELAY_MS = 31_000;

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location: string;
  description: string;
  salary: string;
  job_type: string;
  publication_date: string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class RemotiveProvider implements JobProvider {
  readonly name = 'remotive';
  private boards: Board[];

  constructor(boards: Board[]) {
    this.boards = boards;
  }

  async fetchJobs(): Promise<RawJob[]> {
    const allJobs: RawJob[] = [];

    for (let i = 0; i < this.boards.length; i++) {
      if (i > 0) {
        log.debug({ delayMs: RATE_LIMIT_DELAY_MS }, 'Rate limit delay');
        await delay(RATE_LIMIT_DELAY_MS);
      }

      try {
        const jobs = await this.fetchCategory(this.boards[i]);
        allJobs.push(...jobs);
      } catch (err) {
        log.error({ err, board: this.boards[i].name }, 'Category fetch failed');
      }
    }

    log.info({ total: allJobs.length, categories: this.boards.length }, 'Remotive fetch complete');
    return allJobs;
  }

  private async fetchCategory(board: Board): Promise<RawJob[]> {
    const url = new URL('https://remotive.com/api/remote-jobs');
    if (board.category) {
      url.searchParams.set('category', board.category);
    }
    if (board.keywords) {
      url.searchParams.set('search', board.keywords);
    }

    log.debug({ board: board.name, url: url.toString() }, 'Fetching category');
    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Remotive ${board.name}: HTTP ${response.status}`);
    }

    const data = (await response.json()) as RemotiveResponse;

    return data.jobs.map((job): RawJob => ({
      externalId: String(job.id),
      title: job.title,
      company: job.company_name,
      link: job.url,
      description: job.description,
      location: job.candidate_required_location,
      remoteEligible: true,
      compensation: job.salary || undefined,
    }));
  }
}
