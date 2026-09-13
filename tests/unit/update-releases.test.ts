import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { fetchLatestRelease } from '../../src/server/update/releases.js';
import { getUpdateStatus, refreshUpdateStatus, type UpdateCache } from '../../src/server/update/service.js';
import { OFFICIAL_IMAGE_REPOSITORY, OFFICIAL_REPOSITORY } from '../../src/update/contracts.js';

const validManifest = {
  format: 'tomecms-update', manifestVersion: 1, product: 'tomecms', channel: 'stable',
  version: '1.0.1', releasedAt: '2026-09-20T10:00:00.000Z',
  source: { repository: OFFICIAL_REPOSITORY, commit: '0'.repeat(40) },
  image: {
    repository: OFFICIAL_IMAGE_REPOSITORY,
    digest: `sha256:${'a'.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  },
  compatibility: {
    minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0',
    targetMigration: '007_preview_tokens', rollbackSafeFrom: '1.0.0',
    composeContract: 1, environmentContract: 1, updaterProtocol: 1,
  },
  releaseNotesUrl: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.1',
};
const validManifestDigest = `sha256:${createHash('sha256').update(JSON.stringify(validManifest)).digest('hex')}`;

const validRelease = {
  tag_name: 'v1.0.1', draft: false, prerelease: false, immutable: true,
  published_at: '2026-09-20T10:00:00Z',
  html_url: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.1',
  assets: [{
    name: 'update-manifest.json',
    browser_download_url: 'https://github.com/Dhanabhon/tome-cms/releases/download/v1.0.1/update-manifest.json',
    digest: validManifestDigest,
  }],
};

function releaseFetch(release: object, manifest: object = validManifest): typeof fetch {
  return async (input) => String(input).endsWith('/releases/latest')
    ? Response.json(release, { headers: { etag: '"release-1"' } })
    : Response.json(manifest, { headers: { etag: '"manifest-1"' } });
}

test('loads one immutable stable release and verifies asset metadata', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/releases/latest')) return Response.json(validRelease, { headers: { etag: '"release-1"' } });
    return new Response(JSON.stringify(globalThis.structuredClone(validManifest)), {
      headers: { 'content-type': 'application/json', etag: '"manifest-1"' },
    });
  };
  const result = await fetchLatestRelease({ fetcher: fakeFetch });
  assert.equal(result.manifest.version, '1.0.1');
  assert.equal(result.manifestAssetDigest, validRelease.assets[0].digest);
  assert.equal(result.etag, '"release-1"');
  assert.equal(calls.length, 2);
});

test('rejects downloaded manifest bytes that do not match the release asset digest', async () => {
  await assert.rejects(fetchLatestRelease({
    fetcher: releaseFetch({
      ...validRelease,
      assets: [{ ...validRelease.assets[0], digest: `sha256:${'f'.repeat(64)}` }],
    }),
  }), /digest/i);
});

test('rejects drafts, prereleases, mutable releases, duplicate assets and mismatched tags', async () => {
  const secondAsset = { ...validRelease.assets[0], browser_download_url: `${validRelease.assets[0].browser_download_url}?copy=1` };
  for (const release of [
    { ...validRelease, draft: true },
    { ...validRelease, prerelease: true },
    { ...validRelease, immutable: false },
    { ...validRelease, assets: [...validRelease.assets, secondAsset] },
  ]) await assert.rejects(fetchLatestRelease({ fetcher: releaseFetch(release) }));
  await assert.rejects(fetchLatestRelease({
    fetcher: releaseFetch(validRelease, { ...validManifest, version: '1.0.2' }),
  }));
});

test('caches a successful check, sends its ETag on refresh, and retains it on failure', async () => {
  const cache: UpdateCache = { value: null, etag: null, expiresAt: 0 };
  let now = new Date('2026-09-20T10:00:00.000Z');
  let fail = false;
  let notModified = false;
  const calls: Array<{ url: string; etag: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, etag: new Headers(init?.headers).get('if-none-match') });
    if (fail) return new Response(null, { status: 503 });
    if (url.endsWith('/releases/latest')) {
      if (notModified && new Headers(init?.headers).get('if-none-match') === '"release-1"') {
        return new Response(null, { status: 304 });
      }
      return Response.json(validRelease, { headers: { etag: '"release-1"' } });
    }
    return Response.json(validManifest, { headers: { etag: '"manifest-1"' } });
  };
  const options = { fetcher, cache, now: () => now };

  const first = await getUpdateStatus(options);
  assert.equal(first.availability, 'manual-transition');
  assert.equal(calls.length, 2);
  assert.equal((await getUpdateStatus(options)).checkedAt, first.checkedAt);
  assert.equal(calls.length, 2);

  now = new Date('2026-09-20T11:00:00.000Z');
  notModified = true;
  const revalidated = await refreshUpdateStatus(options);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url.endsWith('/releases/latest'), true);
  assert.equal(calls[2].etag, '"release-1"');
  assert.equal(revalidated.checkedAt, now.toISOString());
  assert.equal(cache.expiresAt, now.getTime() + 6 * 60 * 60 * 1_000);

  notModified = false;
  fail = true;
  assert.deepEqual(await refreshUpdateStatus(options), cache.value);
  assert.equal(cache.value?.availability, 'manual-transition');
});

test('does not cache an invalid manifest', async () => {
  const cache: UpdateCache = { value: null, etag: null, expiresAt: 0 };
  const result = await getUpdateStatus({
    cache,
    now: () => new Date('2026-09-20T10:00:00.000Z'),
    fetcher: releaseFetch(validRelease, { ...validManifest, version: '1.0.2' }),
  });
  assert.equal(result.availability, 'unavailable');
  assert.equal(cache.value, null);
  assert.equal(cache.expiresAt, 0);
});
