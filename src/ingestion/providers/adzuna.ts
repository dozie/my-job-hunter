import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:adzuna' });

const MAX_PAGES = 5;
const RESULTS_PER_PAGE = 50;

interface AdzunaJob {
  id: number;
  title: string;
  company: { display_name: string };
  description: string;
  redirect_url: string;
  location: { display_name: string };
  salary_min?: number;
  salary_max?: number;
}

interface AdzunaResponse {
  results: AdzunaJob[];
}

export class AdzunaProvider implements JobProvider {
  readonly name = 'adzuna';
  private boards: Board[];
  private appId: string;
  private appKey: string;

  constructor(boards: Board[], appId: string, appKey: string) {
    this.boards = boards;
    this.appId = appId;
    this.appKey = appKey;
  }

  async fetchJobs(): Promise<RawJob[]> {
    const results = await Promise.allSettled(
      this.boards.map(board => this.fetchSearch(board)),
    );

    const allJobs: RawJob[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allJobs.push(...result.value);
      } else {
        log.error({ err: result.reason }, 'Search fetch failed');
      }
    }

    log.info({ total: allJobs.length, searches: this.boards.length }, 'Adzuna fetch complete');
    return allJobs;
  }

  private async fetchSearch(board: Board): Promise<RawJob[]> {
    const country = board.country || 'us';
    const allJobs: RawJob[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(
        `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${page}`,
      );
      url.searchParams.set('app_id', this.appId);
      url.searchParams.set('app_key', this.appKey);
      url.searchParams.set('results_per_page', String(RESULTS_PER_PAGE));
      if (board.keywords) {
        url.searchParams.set('what', board.keywords);
      }

      log.debug({ board: board.name, page }, 'Fetching page');
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Adzuna ${board.name} page ${page}: HTTP ${response.status}`);
      }

      const data = (await response.json()) as AdzunaResponse;

      const jobs = data.results.map((job): RawJob => ({
        externalId: String(job.id),
        title: job.title,
        company: job.company?.display_name || board.label || board.name,
        link: job.redirect_url,
        description: job.description,
        location: job.location?.display_name,
        compensation: this.formatSalary(job.salary_min, job.salary_max),
      }));

      allJobs.push(...jobs);

      if (data.results.length < RESULTS_PER_PAGE) break;
    }

    log.debug({ board: board.name, total: allJobs.length }, 'Search complete');
    return allJobs;
  }

  private formatSalary(min?: number, max?: number): string | undefined {
    if (min && max) return `${min.toLocaleString()} – ${max.toLocaleString()}`;
    if (min) return `From ${min.toLocaleString()}`;
    if (max) return `Up to ${max.toLocaleString()}`;
    return undefined;
  }
}
