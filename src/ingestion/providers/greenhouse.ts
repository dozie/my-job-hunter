import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:greenhouse' });

interface GreenhouseJob {
  id: number;
  title: string;
  location: { name: string };
  content: string;
  absolute_url: string;
  updated_at: string;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export class GreenhouseProvider implements JobProvider {
  readonly name = 'greenhouse';
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

    log.info({ total: allJobs.length, boards: this.boards.length }, 'Greenhouse fetch complete');
    return allJobs;
  }

  private async fetchBoard(board: Board): Promise<RawJob[]> {
    const token = board.token || board.name;
    const url = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;

    log.debug({ board: board.name, url }, 'Fetching board');
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Greenhouse ${board.name}: HTTP ${response.status}`);
    }

    const data = (await response.json()) as GreenhouseResponse;

    return data.jobs.map((job): RawJob => ({
      externalId: String(job.id),
      title: job.title,
      company: board.name,
      link: job.absolute_url,
      description: job.content,
      location: job.location?.name,
    }));
  }
}
