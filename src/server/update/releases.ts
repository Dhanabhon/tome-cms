import { createHash, timingSafeEqual } from 'node:crypto';

import {
  OFFICIAL_REPOSITORY,
  UPDATE_MANIFEST_ASSET,
  parseStableVersion,
  parseUpdateManifest,
  type UpdateManifest,
} from '../../update/contracts.js';

const GITHUB_API_VERSION = '2022-11-28';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/latest`;
const MAX_RESPONSE_BYTES = 512 * 1024;

export interface LatestRelease {
  manifest: UpdateManifest;
  publishedAt: string;
  releaseUrl: string;
  manifestAssetDigest: string;
  etag: string | null;
}

export interface FetchLatestReleaseOptions {
  fetcher?: typeof fetch;
  etag?: string;
}

export class ReleaseNotModifiedError extends Error {
  constructor() {
    super('Official release has not changed');
    this.name = 'ReleaseNotModifiedError';
  }
}

/** GitHub answers 404 for releases/latest until a first release exists: there is nothing to check yet. */
export class NoOfficialReleaseError extends Error {
  constructor() {
    super('No official release has been published');
    this.name = 'NoOfficialReleaseError';
  }
}

/** No answer worth reading: no network, the deadline, or GitHub answering with an error. */
export class ReleaseUnreachableError extends Error {
  constructor(detail: string) {
    super(`Official release request failed (${detail})`);
    this.name = 'ReleaseUnreachableError';
  }
}

export async function fetchLatestRelease(
  options: FetchLatestReleaseOptions = {},
): Promise<LatestRelease> {
  const fetcher = options.fetcher ?? fetch;
  const releaseResponse = await fetchJson(fetcher, LATEST_RELEASE_URL, options.etag, true);
  const release = releaseDetails(releaseResponse.json);
  const version = parseStableVersion(release.tagName.slice(1)).raw;
  const releaseUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/tag/${release.tagName}`;
  const manifestUrl = `https://github.com/${OFFICIAL_REPOSITORY}/releases/download/${release.tagName}/${UPDATE_MANIFEST_ASSET}`;

  if (
    release.draft || release.prerelease || !release.immutable ||
    release.htmlUrl !== releaseUrl || !validPublishedAt(release.publishedAt) ||
    release.assets.length !== 1 || release.assets[0].url !== manifestUrl ||
    !/^sha256:[0-9a-f]{64}$/.test(release.assets[0].digest)
  ) throw new Error('Invalid official release');

  const manifestResponse = await fetchBytes(fetcher, manifestUrl);
  verifyDigest(manifestResponse.bytes, release.assets[0].digest);
  const manifest = parseUpdateManifest(JSON.parse(new TextDecoder().decode(manifestResponse.bytes)));
  if (manifest.version !== version) throw new Error('Release tag does not match manifest');

  return {
    manifest,
    publishedAt: release.publishedAt,
    releaseUrl,
    manifestAssetDigest: release.assets[0].digest,
    etag: releaseResponse.etag,
  };
}

async function fetchJson(fetcher: typeof fetch, url: string, etag?: string, allowNotModified = false): Promise<{ json: unknown; etag: string | null }> {
  const response = await fetchBytes(fetcher, url, etag, allowNotModified);
  return { json: JSON.parse(new TextDecoder().decode(response.bytes)), etag: response.etag };
}

async function fetchBytes(fetcher: typeof fetch, url: string, etag?: string, allowNotModified = false): Promise<{ bytes: Uint8Array; etag: string | null }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (etag) headers['If-None-Match'] = etag;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new ReleaseUnreachableError(error instanceof Error ? error.name : 'network');
  }
  if (allowNotModified && response.status === 304) throw new ReleaseNotModifiedError();
  if (url === LATEST_RELEASE_URL && response.status === 404) throw new NoOfficialReleaseError();
  if (!response.ok) throw new ReleaseUnreachableError(String(response.status));
  return { bytes: await boundedBytes(response), etag: response.headers.get('etag') };
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) {
    throw new Error('Official release response is too large');
  }
  if (!response.body) throw new Error('Official release response has no body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Official release response is too large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function verifyDigest(bytes: Uint8Array, digest: string): void {
  const actual = createHash('sha256').update(bytes).digest();
  const expected = Buffer.from(digest.slice('sha256:'.length), 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Official release asset digest mismatch');
  }
}

function releaseDetails(value: unknown): {
  tagName: string;
  draft: boolean;
  prerelease: boolean;
  immutable: boolean;
  publishedAt: string;
  htmlUrl: string;
  assets: Array<{ name: string; url: string; digest: string }>;
} {
  if (!isRecord(value)) throw new Error('Invalid official release');
  const { tag_name, draft, prerelease, immutable, published_at, html_url, assets } = value;
  if (
    typeof tag_name !== 'string' || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag_name) ||
    typeof draft !== 'boolean' || typeof prerelease !== 'boolean' || typeof immutable !== 'boolean' ||
    typeof published_at !== 'string' || typeof html_url !== 'string' || !Array.isArray(assets)
  ) throw new Error('Invalid official release');
  return {
    tagName: tag_name, draft, prerelease, immutable, publishedAt: published_at, htmlUrl: html_url,
    assets: assets.filter(isRecord).filter((asset) => asset.name === UPDATE_MANIFEST_ASSET).map((asset) => ({
      name: asset.name as string,
      url: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
      digest: typeof asset.digest === 'string' ? asset.digest : '',
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPublishedAt(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
