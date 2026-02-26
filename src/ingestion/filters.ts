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

  // 1. Toronto — always pass (user is local, any work arrangement OK)
  if (location.includes('toronto')) {
    return true;
  }

  // 2. Check for remote signal in location or description
  let hasRemoteSignal = false;
  for (const indicator of filters.remote_indicators) {
    const ind = indicator.toLowerCase();
    if (location.includes(ind) || description.includes(ind)) {
      hasRemoteSignal = true;
      break;
    }
  }

  if (!hasRemoteSignal) return false;

  // 3. Reject if onsite/hybrid indicators present — not genuinely remote
  for (const indicator of filters.onsite_indicators) {
    const ind = indicator.toLowerCase();
    if (location.includes(ind) || description.includes(ind)) {
      return false;
    }
  }

  return true;
}
