import type { RawJob } from './providers/base.js';
import type { NewJob } from '../db/schema.js';

/** Strip HTML tags and collapse whitespace */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detect remote eligibility from location/description text */
function detectRemote(location?: string, description?: string): boolean {
  const text = `${location || ''} ${description || ''}`.toLowerCase();
  return text.includes('remote') || text.includes('work from anywhere') || text.includes('distributed');
}

export function normalizeJobs(rawJobs: RawJob[], providerName: string): NewJob[] {
  return rawJobs.map((raw) => ({
    externalId: raw.externalId,
    provider: providerName,
    title: raw.title,
    company: raw.company,
    link: raw.link,
    description: raw.description ? stripHtml(raw.description) : undefined,
    location: raw.location,
    remoteEligible: raw.remoteEligible ?? detectRemote(raw.location, raw.description),
    compensation: raw.compensation,
  }));
}
