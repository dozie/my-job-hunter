import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:serpapi' });

export type ExistingJobChecker = (ids: string[]) => Promise<number>;
export type MonthlyUsageChecker = () => Promise<number>;

export interface SerpApiConfig {
  maxPages: number;
  monthlyBudget: number;
}

interface SerpApiJobResult {
  job_id: string;
  title: string;
  company_name: string;
  location: string;
  description: string;
  share_link: string;
  apply_options?: Array<{ title: string; link: string }>;
  detected_extensions?: {
    posted_at?: string;
    schedule_type?: string;
    salary?: string;
    work_from_home?: boolean;
  };
}

interface SerpApiResponse {
  jobs_results?: SerpApiJobResult[];
  serpapi_pagination?: { next_page_token?: string };
  error?: string;
}

export class SerpApiProvider implements JobProvider {
  readonly name = 'serpapi';
  private boards: Board[];
  private apiKey: string;
  private config: SerpApiConfig;
  private maxDepth: number;
  private checkExisting?: ExistingJobChecker;
  private checkMonthlyUsage?: MonthlyUsageChecker;

  constructor(
    boards: Board[],
    apiKey: string,
    config: SerpApiConfig,
    maxDepth: number = 1,
    checkExisting?: ExistingJobChecker,
    checkMonthlyUsage?: MonthlyUsageChecker,
  ) {
    this.boards = boards;
    this.apiKey = apiKey;
    this.config = config;
    this.maxDepth = maxDepth;
    this.checkExisting = checkExisting;
    this.checkMonthlyUsage = checkMonthlyUsage;
  }

  async fetchJobs(): Promise<RawJob[]> {
    // Budget safety valve — force shallow crawl if nearing monthly limit
    let effectiveDepth = this.maxDepth;
    if (this.checkMonthlyUsage) {
      try {
        const used = await this.checkMonthlyUsage();
        if (used >= this.config.monthlyBudget) {
          log.warn({ used, budget: this.config.monthlyBudget }, 'Monthly budget reached — forcing depth 1');
          effectiveDepth = 1;
        }
      } catch (err) {
        log.error({ err }, 'Failed to check monthly usage — defaulting to depth 1');
        effectiveDepth = 1;
      }
    }

    log.info({ depth: effectiveDepth, boards: this.boards.length }, 'SerpApi fetch starting');

    const results = await Promise.allSettled(
      this.boards.map(board => this.fetchSearch(board, effectiveDepth)),
    );

    const allJobs: RawJob[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allJobs.push(...result.value);
      } else {
        log.error({ err: result.reason }, 'Search fetch failed');
      }
    }

    log.info({ total: allJobs.length, searches: this.boards.length, depth: effectiveDepth }, 'SerpApi fetch complete');
    return allJobs;
  }

  private async fetchSearch(board: Board, effectiveDepth: number): Promise<RawJob[]> {
    const maxPages = Math.min(effectiveDepth, this.config.maxPages);
    const query = board.keywords || 'software engineer';
    const location = board.label || 'Canada';
    const allJobs: RawJob[] = [];
    let nextPageToken: string | undefined;
    let pagesFetched = 0;

    for (let page = 0; page < maxPages; page++) {
      const url = new URL('https://serpapi.com/search');
      url.searchParams.set('engine', 'google_jobs');
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', this.apiKey);
      url.searchParams.set('location', location);
      url.searchParams.set('gl', 'ca');
      url.searchParams.set('google_domain', 'google.ca');
      if (nextPageToken) {
        url.searchParams.set('next_page_token', nextPageToken);
      }

      log.debug({ board: board.name, page, maxPages }, 'Fetching page');

      let response: Response;
      try {
        response = await fetch(url.toString());
      } catch (err) {
        // Network error on deeper pages — return partial results
        if (page > 0) {
          log.warn({ err, board: board.name, page }, 'Network error on deeper page — returning partial results');
          break;
        }
        throw err;
      }

      if (!response.ok) {
        // Graceful degradation on deeper pages
        if (page > 0) {
          log.warn({ board: board.name, page, status: response.status }, 'HTTP error on deeper page — returning partial results');
          break;
        }
        throw new Error(`SerpApi ${board.name} page ${page}: HTTP ${response.status}`);
      }

      const data = (await response.json()) as SerpApiResponse;

      if (data.error) {
        if (page > 0) {
          log.warn({ board: board.name, page, error: data.error }, 'API error on deeper page — returning partial results');
          break;
        }
        throw new Error(`SerpApi ${board.name}: ${data.error}`);
      }

      pagesFetched++;

      const mapped = (data.jobs_results ?? [])
        .map((job): RawJob => ({
          externalId: job.job_id,
          title: job.title,
          company: job.company_name,
          link: this.pickBestLink(job),
          description: job.description,
          location: job.location,
          remoteEligible: job.detected_extensions?.work_from_home === true ? true : undefined,
          compensation: job.detected_extensions?.salary,
          metadata: {
            postedAt: job.detected_extensions?.posted_at,
            scheduleType: job.detected_extensions?.schedule_type,
            shareLink: job.share_link,
          },
        }));

      allJobs.push(...mapped);

      // Newness gate: if page 1 results are all already in DB, skip deeper pages
      if (page === 0 && maxPages > 1 && this.checkExisting && mapped.length > 0) {
        try {
          const ids = mapped.map(j => j.externalId);
          const existingCount = await this.checkExisting(ids);
          if (existingCount === ids.length) {
            log.info({ board: board.name, checked: ids.length, existing: existingCount }, 'Page 1 all seen — skipping deeper pages');
            break;
          }
          log.debug({ board: board.name, checked: ids.length, existing: existingCount, new: ids.length - existingCount }, 'Newness check — proceeding to deeper pages');
        } catch (err) {
          log.error({ err, board: board.name }, 'Newness check failed — proceeding anyway');
        }
      }

      nextPageToken = data.serpapi_pagination?.next_page_token;
      if (!nextPageToken) break;
    }

    log.info(
      { board: board.name, pagesAttempted: Math.min(maxPages, pagesFetched + 1), pagesFetched, totalResults: allJobs.length },
      'Search complete',
    );
    return allJobs;
  }

  private pickBestLink(job: SerpApiJobResult): string {
    if (job.apply_options && job.apply_options.length > 0) {
      return job.apply_options[0].link;
    }
    return job.share_link
      || `https://www.google.com/search?q=${encodeURIComponent(job.title + ' ' + job.company_name)}&ibp=htl;jobs`;
  }
}
