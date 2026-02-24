export interface RawJob {
  externalId: string;
  title: string;
  company: string;
  link: string;
  description?: string;
  location?: string;
  remoteEligible?: boolean;
  seniority?: string;
  compensation?: string;
  metadata?: Record<string, unknown>;
}

export interface JobProvider {
  name: string;
  fetchJobs(): Promise<RawJob[]>;
}
