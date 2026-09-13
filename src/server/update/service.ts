import { compareStableVersions, parseStableVersion } from '../../update/contracts.js';
import { getBuildInfo } from './current.js';
import { fetchLatestRelease, type LatestRelease } from './releases.js';

const CACHE_SECONDS = 6 * 60 * 60;

export type UpdateAvailability = 'current' | 'available' | 'manual-transition' | 'unavailable';

export interface UpdateCheck {
  checkedAt: string;
  currentVersion: string;
  availability: UpdateAvailability;
  latest: LatestRelease | null;
  message: string;
}

export interface UpdateCache {
  value: UpdateCheck | null;
  etag: string | null;
  expiresAt: number;
}

export interface UpdateServiceOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
  cache?: UpdateCache;
}

const cache: UpdateCache = { value: null, etag: null, expiresAt: 0 };

export async function getUpdateStatus(options: UpdateServiceOptions = {}): Promise<UpdateCheck> {
  const now = options.now ?? (() => new Date());
  const activeCache = options.cache ?? cache;
  if (activeCache.value && activeCache.expiresAt > now().getTime()) return activeCache.value;
  return refreshUpdateStatus(options);
}

export async function refreshUpdateStatus(options: UpdateServiceOptions = {}): Promise<UpdateCheck> {
  const now = options.now ?? (() => new Date());
  const activeCache = options.cache ?? cache;
  const checkedAt = now().toISOString();
  const currentVersion = getBuildInfo().version;
  try {
    const latest = await fetchLatestRelease({ fetcher: options.fetcher, etag: activeCache.etag ?? undefined });
    const value = successfulCheck(currentVersion, latest, checkedAt);
    activeCache.value = value;
    activeCache.etag = latest.etag;
    activeCache.expiresAt = now().getTime() + CACHE_SECONDS * 1_000;
    return value;
  } catch {
    return activeCache.value ?? {
      checkedAt,
      currentVersion,
      availability: 'unavailable',
      latest: null,
      message: 'Update check unavailable.',
    };
  }
}

function successfulCheck(currentVersion: string, latest: LatestRelease, checkedAt: string): UpdateCheck {
  const current = parseStableVersion(currentVersion).parts;
  const latestVersion = latest.manifest.version;
  const comparison = compareStableVersions(currentVersion, latestVersion);
  if (comparison >= 0) {
    return { checkedAt, currentVersion, availability: 'current', latest, message: 'TomeCMS is up to date.' };
  }
  if (current[0] === 0 && parseStableVersion(latestVersion).parts[0] >= 1) {
    return {
      checkedAt,
      currentVersion,
      availability: 'manual-transition',
      latest,
      message: 'A manual transition to TomeCMS 1.0.0 is required.',
    };
  }
  return {
    checkedAt,
    currentVersion,
    availability: 'available',
    latest,
    message: `TomeCMS ${latestVersion} is available.`,
  };
}
