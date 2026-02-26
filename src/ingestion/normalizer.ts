import { createHash } from 'node:crypto';
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

/** Normalize company name for dedup: lowercase, strip suffixes, collapse whitespace */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc\.?|incorporated|ltd\.?|limited|corp\.?|corporation|llc|l\.l\.c\.|co\.?|company)\b/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize title for dedup: lowercase, normalize senior/sr/jr variations, collapse whitespace */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bsr\.?\b/g, 'senior')
    .replace(/\bjr\.?\b/g, 'junior')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short hash of first 500 chars of description to distinguish same-title roles on different teams */
function descriptionFingerprint(description?: string): string {
  if (!description) return 'nodesc';
  const normalized = description.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

export function buildCanonicalKey(company: string, title: string, description?: string): string {
  return `${normalizeCompany(company)}::${normalizeTitle(title)}::${descriptionFingerprint(description)}`;
}

/** Detect remote eligibility from location/description text */
function detectRemote(location?: string, description?: string): boolean {
  const text = `${location || ''} ${description || ''}`.toLowerCase();
  return text.includes('remote') || text.includes('work from anywhere') || text.includes('distributed');
}

export function normalizeJobs(rawJobs: RawJob[], providerName: string): NewJob[] {
  return rawJobs.map((raw) => {
    const strippedDescription = raw.description ? stripHtml(raw.description) : undefined;
    return {
      externalId: raw.externalId,
      provider: providerName,
      title: raw.title,
      company: raw.company,
      link: raw.link,
      description: strippedDescription,
      location: raw.location,
      remoteEligible: raw.remoteEligible ?? detectRemote(raw.location, raw.description),
      compensation: raw.compensation,
      canonicalKey: buildCanonicalKey(raw.company, raw.title, strippedDescription),
    };
  });
}
