import type { JobProvider, RawJob } from './base.js';
import type { Board } from '../../config/providers.js';
import { logger } from '../../observability/logger.js';

const log = logger.child({ module: 'provider:serpapi' });

const RESULTS_PER_PAGE = 10; // Fixed by Google Jobs API
const MAX_PAGES = 3; // Safety cap to protect free tier budget

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

  constructor(boards: Board[], apiKey: string) {
    this.boards = boards;
    this.apiKey = apiKey;
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

    log.info({ total: allJobs.length, searches: this.boards.length }, 'SerpApi fetch complete');
    return allJobs;
  }

  private async fetchSearch(board: Board): Promise<RawJob[]> {
    const maxCollect = board.maxCollect ?? RESULTS_PER_PAGE;
    const maxPages = Math.min(Math.ceil(maxCollect / RESULTS_PER_PAGE), MAX_PAGES);
    const query = board.keywords || 'software engineer';
    const location = board.label || 'Canada';
    const allJobs: RawJob[] = [];
    let nextPageToken: string | undefined;

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

      log.debug({ board: board.name, page }, 'Fetching page');
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`SerpApi ${board.name} page ${page}: HTTP ${response.status}`);
      }

      const data = (await response.json()) as SerpApiResponse;

      if (data.error) {
        throw new Error(`SerpApi ${board.name}: ${data.error}`);
      }

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

      nextPageToken = data.serpapi_pagination?.next_page_token;
      if (!nextPageToken || allJobs.length >= maxCollect) break;
    }

    log.debug({ board: board.name, total: allJobs.length }, 'Search complete');
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
