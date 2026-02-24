import type { RawJob } from './providers/base.js';
import type { FiltersConfig } from '../config/providers.js';

export function passesRoleFilter(job: RawJob, filters: FiltersConfig): boolean {
  const title = job.title.toLowerCase();

  // Exclusion runs first
  for (const keyword of filters.exclude_titles) {
    if (title.includes(keyword.toLowerCase())) {
      return false;
    }
  }

  // Must match at least one inclusion keyword
  for (const keyword of filters.include_titles) {
    if (title.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  return false;
}

export function passesLocationFilter(job: RawJob, filters: FiltersConfig): boolean {
  const location = (job.location || '').toLowerCase();
  const description = (job.description || '').toLowerCase();

  // Check location field
  for (const keyword of filters.location_keywords) {
    if (location.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  // Check description for remote indicators
  for (const indicator of filters.remote_indicators) {
    if (description.includes(indicator.toLowerCase())) {
      return true;
    }
    if (location.includes(indicator.toLowerCase())) {
      return true;
    }
  }

  return false;
}
