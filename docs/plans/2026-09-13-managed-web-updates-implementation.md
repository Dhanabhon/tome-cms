# TomeCMS Managed Web Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe stable-release checks everywhere and one-click, Passkey-confirmed application updates on fresh managed TomeCMS VPS installations without exposing Docker authority to Astro.

**Architecture:** The Astro app reads public GitHub Releases and, only on managed VPS installs, forwards an exact stable version over a Unix socket to a dedicated host updater. The updater independently verifies an immutable release manifest and GitHub attestations, pulls the exact GHCR digest, stops writes, creates a complete backup, runs forward migrations, replaces only the app container, and rolls back the image when the manifest says the upgraded schema remains compatible.

**Tech Stack:** Astro 5 Node SSR, React 18, strict TypeScript, Node.js 22 standard library, Zod 4, Better Auth Passkeys, PostgreSQL 17/Kysely, SeaweedFS/S3, Docker Compose, systemd, GitHub Releases, GHCR, GitHub artifact attestations, Node test runner, Playwright.

**Spec:** [`docs/specs/2026-09-13-managed-web-updates-design.md`](../specs/2026-09-13-managed-web-updates-design.md)

## Global Constraints

- Stable channel only; accept versions matching stable `major.minor.patch` SemVer core with no prerelease or build suffix.
- Only fresh managed VPS installations created by TomeCMS `1.0.0+` may install from Admin.
- Local, Windows, macOS, pre-`1.0.0`, and source-built Compose installations remain check-only.
- Compile the official repository as `Dhanabhon/tome-cms` and image as `ghcr.io/dhanabhon/tome-cms`; never accept either from a browser or environment variable.
- Pull and run application images only by `sha256:` digest.
- Never mount `/var/run/docker.sock` into the Astro application container.
- The host updater accepts only an exact target version over a root-owned Unix socket and independently fetches the official release.
- Require a same-origin owner request and a Passkey-created session no older than five minutes before applying an update.
- Run at most one update job at a time.
- Create and validate a complete PostgreSQL plus S3 backup before changing the image selection or running migrations.
- Production migrations remain forward-only and use the `1.x` expand/contract rule; never run a down migration automatically.
- Do not pull or replace PostgreSQL, SeaweedFS, Docker Engine, reverse proxy, DNS, or TLS during an app update.
- Keep `/api/v1` stable throughout `1.x`; do not change bundled/Headless public behavior.
- Use Node standard-library APIs and already-installed dependencies. Do not add a queue, Redis, update database, process manager, shell interpolation, generic plugin mechanism, or central TomeCMS service.
- Use TDD for every parser, state transition, security gate, and transaction branch: red, minimum green, focused check, commit.
- Stage only files named by the current task. Before every commit run `git diff --cached --check`, inspect `git diff --cached --stat`, and scan staged content for credentials.
- Keep the existing unrelated untracked overview artifacts, pnpm files, and `supabase/` directory untouched.

## Deliverable Sequence

This plan has three independently reviewable milestones:

1. **Check-only foundation:** Tasks 1–4. Every installation can safely report stable release availability; no host command exists.
2. **Release and updater engine:** Tasks 5–9. CI publishes verifiable artifacts and a host-only transaction passes deterministic failure tests.
3. **Managed VPS integration:** Tasks 10–12. Fresh `1.0.0` VPS installs gain the socket bridge and one-click flow; the first acceptance path is `1.0.0 → 1.0.1`.

Do not enable `TOME_CMS_UPDATE_MODE=managed` until every task is complete and the repository is public with immutable releases enabled.

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| Shared contracts | `src/update/contracts.ts`, `tests/unit/update-contracts.test.ts` | none |
| Build identity/environment | `src/server/update/current.ts`, `tests/unit/update-current.test.ts` | `src/server/env.ts`, `tests/unit/env.test.ts`, `.env.example`, `Dockerfile` |
| Release discovery | `src/server/update/releases.ts`, `src/server/update/service.ts`, `tests/unit/update-releases.test.ts` | `src/server/auth/rate-limit.ts` |
| Check-only Admin | `src/server/update/admin.ts`, `src/pages/api/admin/system/updates.ts`, `src/pages/admin/system.astro`, `src/components/admin/UpdateManager.tsx`, `tests/unit/update-admin.test.ts` | `src/components/admin/AdminShell.astro`, `src/styles/global.css` |
| Release publishing | `.github/workflows/release.yml`, `scripts/release-manifest.ts`, `tests/unit/release-manifest.test.ts` | `package.json` |
| Updater foundation | `src/updater/config.ts`, `src/updater/state.ts`, `src/updater/process.ts`, `src/updater/server.ts`, `src/updater/main.ts`, `tsconfig.updater.json`, `tests/unit/updater-config.test.ts`, `tests/unit/updater-state.test.ts`, `tests/unit/updater-server.test.ts` | `package.json`, `.gitignore` |
| Release verification | `src/updater/verify.ts`, `tests/unit/updater-verify.test.ts` | none |
| Managed backup | `tests/unit/backup-direct.test.ts` | `scripts/backup.ts`, `Dockerfile` |
| Update transaction | `src/updater/transaction.ts`, `tests/unit/updater-transaction.test.ts` | `src/updater/server.ts`, `src/updater/main.ts` |
| App apply bridge | `src/server/update/updater-client.ts`, `src/server/auth/fresh-session.ts`, `src/server/update/maintenance.ts`, `tests/unit/update-updater-client.test.ts`, `tests/unit/update-maintenance.test.ts` | `src/pages/api/admin/system/updates.ts`, `src/pages/api/admin/security/recovery-codes.ts`, `src/components/admin/UpdateManager.tsx`, `src/middleware.ts` |
| Managed VPS install | `compose.managed.yaml`, `config/systemd/tomecms-updater.service`, `scripts/install-managed-vps.sh`, `tests/unit/managed-installer.test.ts` | `scripts/deploy-vps.sh`, `scripts/bootstrap-core.mjs`, `tests/unit/bootstrap-core.test.ts`, `.dockerignore`, `README.md` |
| Release acceptance | `tests/operations/managed-update.test.ts`, `docs/releases/1.0.0.md` | `README.md`, `package.json` |

---

## Milestone 1: Check-only foundation

### Task 1: Define strict update and stable-version contracts

**Files:**

- Create: `src/update/contracts.ts`
- Create: `tests/unit/update-contracts.test.ts`

**Interfaces:**

- Produces: `OFFICIAL_REPOSITORY`, `OFFICIAL_IMAGE_REPOSITORY`, `StableVersion`, `UpdateManifest`, `parseStableVersion()`, `compareStableVersions()`, `parseUpdateManifest()`.
- Consumes: Node/TypeScript only; this module must be safe to compile into Astro and the host updater.

- [ ] **Step 1: Write the failing version and manifest tests**

Create `tests/unit/update-contracts.test.ts` with the exact valid manifest from the spec and these assertions:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareStableVersions,
  OFFICIAL_IMAGE_REPOSITORY,
  OFFICIAL_REPOSITORY,
  parseStableVersion,
  parseUpdateManifest,
} from '../../src/update/contracts.js';

const manifest = {
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

test('parses stable versions and compares numeric tuples', () => {
  assert.deepEqual(parseStableVersion('1.20.3'), { raw: '1.20.3', parts: [1, 20, 3] });
  assert.equal(compareStableVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareStableVersions('1.0.0', '1.0.0'), 0);
  for (const value of ['v1.0.0', '01.0.0', '1.0', '1.0.0-beta.1', '1.0.0+build']) {
    assert.throws(() => parseStableVersion(value), /stable version/i);
  }
});

test('accepts only the closed official manifest contract', () => {
  assert.equal(parseUpdateManifest(manifest).version, '1.0.1');
  for (const invalid of [
    { ...manifest, extra: true },
    { ...manifest, source: { ...manifest.source, repository: 'attacker/repo' } },
    { ...manifest, image: { ...manifest.image, repository: 'evil.example/app' } },
    { ...manifest, image: { ...manifest.image, platforms: ['linux/amd64', 'linux/amd64'] } },
    { ...manifest, releaseNotesUrl: 'https://evil.example/v1.0.1' },
  ]) assert.throws(() => parseUpdateManifest(invalid));
});
```

- [ ] **Step 2: Run the test red**

```sh
node --import tsx --test tests/unit/update-contracts.test.ts
```

Expected: FAIL because `src/update/contracts.ts` does not exist.

- [ ] **Step 3: Implement the closed contract without a new SemVer dependency**

Create `src/update/contracts.ts` with these exported shapes:

```ts
export const OFFICIAL_REPOSITORY = 'Dhanabhon/tome-cms' as const;
export const OFFICIAL_IMAGE_REPOSITORY = 'ghcr.io/dhanabhon/tome-cms' as const;
export const UPDATE_MANIFEST_ASSET = 'update-manifest.json' as const;

export interface StableVersion {
  raw: string;
  parts: readonly [number, number, number];
}

export interface UpdateManifest {
  format: 'tomecms-update';
  manifestVersion: 1;
  product: 'tomecms';
  channel: 'stable';
  version: string;
  releasedAt: string;
  source: { repository: typeof OFFICIAL_REPOSITORY; commit: string };
  image: {
    repository: typeof OFFICIAL_IMAGE_REPOSITORY;
    digest: string;
    platforms: Array<'linux/amd64' | 'linux/arm64'>;
  };
  compatibility: {
    minimumDirectUpgradeFrom: string;
    minimumUpdaterVersion: string;
    targetMigration: string;
    rollbackSafeFrom: string;
    composeContract: number;
    environmentContract: number;
    updaterProtocol: number;
  };
  releaseNotesUrl: string;
}

export function parseStableVersion(value: unknown): StableVersion;
export function compareStableVersions(left: string, right: string): -1 | 0 | 1;
export function parseUpdateManifest(value: unknown): UpdateManifest;
```

Use `Object.getPrototypeOf(value) === Object.prototype`, exact-key comparison, finite safe integers, duplicate detection, `Date.parse()` plus round-trip ISO validation, and the literal/regex rules from the spec. Reject unknown keys at every object level. Do not coerce input.

- [ ] **Step 4: Run the focused checks**

```sh
node --import tsx --test tests/unit/update-contracts.test.ts
npm run check
```

Expected: both pass with no dependency change.

- [ ] **Step 5: Commit the contract**

```sh
git add src/update/contracts.ts tests/unit/update-contracts.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(updates): define release manifest contract"
```

### Task 2: Expose build identity and installation update mode

**Files:**

- Create: `src/server/update/current.ts`
- Create: `tests/unit/update-current.test.ts`
- Modify: `src/server/env.ts`
- Modify: `tests/unit/env.test.ts`
- Modify: `.env.example`
- Modify: `Dockerfile`

**Interfaces:**

- Consumes: `parseStableVersion()` from Task 1 and the existing `getServerEnv()` pattern.
- Produces: `UpdateMode`, `BuildInfo`, `getBuildInfo()`, `TOME_CMS_UPDATE_MODE`, `TOME_CMS_UPDATER_SOCKET`, OCI labels and baked build identity.

- [ ] **Step 1: Add failing environment and build-identity tests**

Add assertions to `tests/unit/env.test.ts`:

```ts
assert.equal(parseServerEnv(valid).TOME_CMS_UPDATE_MODE, 'check-only');
assert.equal(parseServerEnv(valid).TOME_CMS_UPDATER_SOCKET, '/run/tome-cms/updater.sock');
assert.throws(() => parseServerEnv({ ...valid, TOME_CMS_UPDATE_MODE: 'root' }));
assert.throws(() => parseServerEnv({ ...valid, TOME_CMS_UPDATER_SOCKET: '../../docker.sock' }));
```

Create `tests/unit/update-current.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { getBuildInfo } from '../../src/server/update/current.js';

test('prefers baked release identity and validates it', () => {
  assert.deepEqual(getBuildInfo({
    TOME_CMS_VERSION: '1.0.1', TOME_CMS_COMMIT_SHA: 'a'.repeat(40),
  }), { version: '1.0.1', commitSha: 'a'.repeat(40) });
  assert.throws(() => getBuildInfo({ TOME_CMS_VERSION: 'latest', TOME_CMS_COMMIT_SHA: 'main' }));
});
```

- [ ] **Step 2: Run both tests red**

```sh
node --import tsx --test tests/unit/env.test.ts tests/unit/update-current.test.ts
```

Expected: FAIL because the update fields and build module are absent.

- [ ] **Step 3: Add the two server-only environment values**

Extend `serverEnvSchema` without adding `PUBLIC_` variables:

```ts
TOME_CMS_UPDATE_MODE: z.enum(['check-only', 'managed']).default('check-only'),
TOME_CMS_UPDATER_SOCKET: z.string()
  .regex(/^\/run\/tome-cms\/[a-z0-9.-]+\.sock$/)
  .default('/run/tome-cms/updater.sock'),
```

Document both in `.env.example` with `check-only` as the default. Managed bootstrap is the only code allowed to write `managed`.

- [ ] **Step 4: Implement build identity with an explicit test input**

`src/server/update/current.ts` exports:

```ts
export type UpdateMode = 'check-only' | 'managed';
export interface BuildInfo { version: string; commitSha: string | null }

export function getBuildInfo(
  input: Pick<NodeJS.ProcessEnv, 'TOME_CMS_VERSION' | 'TOME_CMS_COMMIT_SHA'> = process.env,
): BuildInfo;
```

Use `package.json` version when `TOME_CMS_VERSION` is absent or blank and return `null` for an absent/blank commit in non-release/source builds. Validate any non-blank supplied commit as 40 lowercase hexadecimal characters.

- [ ] **Step 5: Bake version/revision into the release image**

Add build arguments and OCI labels to both Docker stages, then pass the values into the runtime environment:

```dockerfile
ARG TOME_CMS_VERSION
ARG TOME_CMS_COMMIT_SHA
LABEL org.opencontainers.image.source="https://github.com/Dhanabhon/tome-cms" \
      org.opencontainers.image.version=$TOME_CMS_VERSION \
      org.opencontainers.image.revision=$TOME_CMS_COMMIT_SHA
ENV TOME_CMS_VERSION=$TOME_CMS_VERSION TOME_CMS_COMMIT_SHA=$TOME_CMS_COMMIT_SHA
```

Release builds always pass both values. A source build with blank arguments falls back to `package.json` at runtime; never bake an image digest into itself.

- [ ] **Step 6: Run and commit**

```sh
node --import tsx --test tests/unit/env.test.ts tests/unit/update-current.test.ts
npm run check
git add src/server/update/current.ts tests/unit/update-current.test.ts src/server/env.ts tests/unit/env.test.ts .env.example Dockerfile
git diff --cached --check
git diff --cached --stat
git commit -m "feat(updates): expose managed build identity"
```

### Task 3: Fetch and cache the official stable release

**Files:**

- Create: `src/server/update/releases.ts`
- Create: `src/server/update/service.ts`
- Create: `tests/unit/update-releases.test.ts`
- Modify: `src/server/auth/rate-limit.ts`

**Interfaces:**

- Consumes: Task 1 manifest/version functions and Task 2 `BuildInfo`.
- Produces: `LatestRelease`, `FetchLatestReleaseOptions`, `fetchLatestRelease()`, `getUpdateStatus()`, `refreshUpdateStatus()`.

- [ ] **Step 1: Write the failing release-client tests**

Create a local fake `fetch` in `tests/unit/update-releases.test.ts`; never call GitHub from tests:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchLatestRelease } from '../../src/server/update/releases.js';
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

const validRelease = {
  tag_name: 'v1.0.1', draft: false, prerelease: false, immutable: true,
  published_at: '2026-09-20T10:00:00Z',
  html_url: 'https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.1',
  assets: [{
    name: 'update-manifest.json',
    browser_download_url: 'https://github.com/Dhanabhon/tome-cms/releases/download/v1.0.1/update-manifest.json',
    digest: `sha256:${'b'.repeat(64)}`,
  }],
};

function releaseFetch(release: object, manifest: object = validManifest): typeof fetch {
  return async (input) => String(input).endsWith('/releases/latest')
    ? Response.json(release)
    : Response.json(manifest, { headers: { etag: '"manifest-1"' } });
}

test('loads one immutable stable release and verifies asset metadata', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.endsWith('/releases/latest')) return Response.json(validRelease);
    return new Response(JSON.stringify(globalThis.structuredClone(validManifest)), {
      headers: { 'content-type': 'application/json', etag: '"manifest-1"' },
    });
  };
  const result = await fetchLatestRelease({ fetcher: fakeFetch });
  assert.equal(result.manifest.version, '1.0.1');
  assert.equal(calls.length, 2);
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
```

- [ ] **Step 2: Run red**

```sh
node --import tsx --test tests/unit/update-releases.test.ts
```

Expected: FAIL because the release modules do not exist.

- [ ] **Step 3: Implement bounded official discovery**

`src/server/update/releases.ts` exports:

```ts
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

export async function fetchLatestRelease(options?: FetchLatestReleaseOptions): Promise<LatestRelease>;
```

Use only the compiled endpoint `https://api.github.com/repos/Dhanabhon/tome-cms/releases/latest`, a five-second `AbortSignal.timeout()`, 512 KiB response limits, strict release-object key selection, exactly one manifest asset, official GitHub release/download URL prefixes, tag/manifest equality, and `parseUpdateManifest()`. Keep the asset digest for the host updater; the check-only app reports compatibility but does not treat its own fetch as installation authorization.

- [ ] **Step 4: Add the six-hour cache and compatibility view**

`src/server/update/service.ts` owns one in-process cache and exports:

```ts
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
export async function getUpdateStatus(options?: UpdateServiceOptions): Promise<UpdateCheck>;
export async function refreshUpdateStatus(options?: UpdateServiceOptions): Promise<UpdateCheck>;
```

Both functions accept an optional `{ fetcher, now, cache }` test dependency object; production omits it and uses one module-local cache. `getUpdateStatus()` may serve a successful value for six hours. `refreshUpdateStatus()` sends the cached ETag and preserves the last success when GitHub returns an error. `0.x → 1.x` returns `manual-transition`; equal/newer local versions return `current`.

- [ ] **Step 5: Add an update-check rate limit action**

Extend the existing union and limit table:

```ts
export type RateLimitAction =
  | 'install' | 'signin' | 'recovery' | 'update-check' | 'update-apply';

// in limits
'update-check': { attempts: 6, windowSeconds: 10 * 60 },
'update-apply': { attempts: 3, windowSeconds: 30 * 60 },
```

- [ ] **Step 6: Test cache/ETag behavior and commit**

Add deterministic clock/fetch injection to `service.ts` so the test proves: one fetch within six hours, a conditional refresh, cached fallback on failure, and no cached invalid manifest.

```sh
node --import tsx --test tests/unit/update-contracts.test.ts tests/unit/update-releases.test.ts
npm run check
git add src/server/update/releases.ts src/server/update/service.ts tests/unit/update-releases.test.ts src/server/auth/rate-limit.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(updates): check official stable releases"
```

### Task 4: Ship a friendly check-only System page

**Files:**

- Create: `src/pages/api/admin/system/updates.ts`
- Create: `src/pages/admin/system.astro`
- Create: `src/components/admin/UpdateManager.tsx`
- Create: `src/server/update/admin.ts`
- Create: `tests/unit/update-admin.test.ts`
- Modify: `src/components/admin/AdminShell.astro`
- Modify: `src/styles/global.css`

**Interfaces:**

- Consumes: Task 3 update service, existing owner/session/origin/error helpers, `AdminShell`, and existing Admin controls.
- Produces: `GET/POST /api/admin/system/updates`, `/admin/system`, and an Admin navigation item.

- [ ] **Step 1: Write a failing request-contract test**

Create `src/server/update/admin.ts` so tests can import the request contract without initializing runtime credentials. The contract is:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { updateActionSchema } from '../../src/server/update/admin.js';

test('accepts only check or one exact stable target', () => {
  assert.deepEqual(updateActionSchema.parse({ action: 'check' }), { action: 'check' });
  assert.deepEqual(updateActionSchema.parse({ action: 'apply', version: '1.0.1' }), { action: 'apply', version: '1.0.1' });
  for (const value of [
    { action: 'apply', version: 'latest' },
    { action: 'apply', version: '1.0.1', image: 'evil' },
    { action: 'run', command: 'docker' },
  ]) assert.throws(() => updateActionSchema.parse(value));
});
```

Implement the schema with the installed Zod dependency:

```ts
const stableVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
export const updateActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check') }).strict(),
  z.object({ action: z.literal('apply'), version: stableVersion }).strict(),
]);
export type UpdateAction = z.infer<typeof updateActionSchema>;
```

- [ ] **Step 2: Run red, then implement the check-only endpoint**

```sh
node --import tsx --test tests/unit/update-admin.test.ts
```

The endpoint must:

```ts
export const GET: APIRoute;  // requireInstalledOwner, return cached status
export const POST: APIRoute; // same origin + update-check rate limit
```

`POST { action: 'check' }` calls `refreshUpdateStatus()`. During this milestone, `apply` always returns `409` with `Managed updates are not available on this installation.` Both methods return `Cache-Control: no-store` and `X-Request-ID`.

- [ ] **Step 3: Add the Admin route and navigation**

Extend `AdminShell`’s `active` union with `'system'`, then add:

```ts
{ id: 'system', href: adminHref(adminSettings, '/system'), label: 'System' },
```

`src/pages/admin/system.astro` follows `settings.astro`: require the owner, load settings, redirect unauthenticated users to the configured Admin login, return `404` for a non-owner, and render:

```astro
<AdminShell active="system" adminPath={settings.admin_path} siteName={settings.site_name} userEmail={userEmail}>
  <section class="admin-page admin-form-page">
    <header class="admin-page__head"><div><h1>System updates</h1><p>Keep TomeCMS current with verified stable releases.</p></div></header>
    <UpdateManager client:load />
  </section>
</AdminShell>
```

- [ ] **Step 4: Implement the accessible React status UI**

`UpdateManager` loads the GET endpoint on mount, exposes `Check again`, renders the five spec statuses, and always shows why installation is unavailable. Use an `aria-live="polite"` status region, native button disabled state, text plus color, and an external release-notes link with `target="_blank" rel="noopener noreferrer"`.

During this task, no component imports Docker/updater code and no Install button is rendered.

- [ ] **Step 5: Add only page-specific design-system CSS**

Reuse `admin-button`, `admin-control`, color tokens, spacing tokens, and existing page width. Add `.update-card`, `.update-version`, and `.update-status` rules only; do not add a new font, color palette, shadow system, animation library, or dashboard grid.

- [ ] **Step 6: Verify and commit milestone 1**

```sh
node --import tsx --test tests/unit/update-admin.test.ts tests/unit/update-releases.test.ts
npm run check
npm run build
git add src/server/update/admin.ts src/pages/api/admin/system/updates.ts src/pages/admin/system.astro src/components/admin/UpdateManager.tsx tests/unit/update-admin.test.ts src/components/admin/AdminShell.astro src/styles/global.css
git diff --cached --check
git diff --cached --stat
git commit -m "feat(admin): add check-only system updates page"
```

---

## Milestone 2: Release and updater engine

### Task 5: Publish immutable, attested multi-architecture releases

**Files:**

- Create: `scripts/release-manifest.ts`
- Create: `tests/unit/release-manifest.test.ts`
- Create: `.github/workflows/release.yml`
- Modify: `package.json`

**Interfaces:**

- Consumes: Task 1 `UpdateManifest` parser and Dockerfile build args from Task 2.
- Produces: `buildReleaseManifest()`, `npm run release:manifest`, GHCR image, `update-manifest.json`, image attestation, manifest attestation, GitHub Release.

- [ ] **Step 1: Write the failing manifest-builder test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReleaseManifest } from '../../scripts/release-manifest.js';

const validInput = {
  packageVersion: '1.0.1', tag: 'v1.0.1', commit: 'a'.repeat(40),
  digest: `sha256:${'b'.repeat(64)}`,
  releasedAt: '2026-09-20T10:00:00.000Z',
  minimumDirectUpgradeFrom: '1.0.0', minimumUpdaterVersion: '1.0.0',
  targetMigration: '007_preview_tokens', rollbackSafeFrom: '1.0.0',
};

test('builds the official manifest only when package, tag and digest agree', () => {
  const result = buildReleaseManifest(validInput);
  assert.equal(result.version, '1.0.1');
  assert.equal(result.image.repository, 'ghcr.io/dhanabhon/tome-cms');
  assert.throws(() => buildReleaseManifest({ ...validInput, tag: 'v1.0.2' }), /tag/i);
  assert.throws(() => buildReleaseManifest({ ...validInput, commit: 'main' }), /commit/i);
  assert.throws(() => buildReleaseManifest({ ...validInput, digest: 'sha256:bad' }), /digest/i);
  assert.throws(() => buildReleaseManifest({ ...validInput, rollbackSafeFrom: '1.0.2' }), /rollback/i);
});
```

- [ ] **Step 2: Run red and implement the builder/CLI**

```sh
node --import tsx --test tests/unit/release-manifest.test.ts
```

Export:

```ts
export interface ReleaseManifestInput {
  packageVersion: string; tag: string; commit: string; digest: string; releasedAt: string;
  minimumDirectUpgradeFrom: string; minimumUpdaterVersion: string;
  targetMigration: string; rollbackSafeFrom: string;
}
export function buildReleaseManifest(input: ReleaseManifestInput): UpdateManifest;
```

The CLI reads named arguments, calls `buildReleaseManifest()`, reparses with `parseUpdateManifest()`, and writes exactly one newline-terminated JSON file using `flag: 'wx'`. It refuses to overwrite an existing output.

- [ ] **Step 3: Add the package command**

```json
"release:manifest": "node --import tsx scripts/release-manifest.ts"
```

- [ ] **Step 4: Add the tag release workflow**

Create `.github/workflows/release.yml` triggered by `v[0-9]+.[0-9]+.[0-9]+` tags. Give the job only:

```yaml
permissions:
  attestations: write
  contents: write
  id-token: write
  packages: write
```

The workflow must perform this exact order:

```text
checkout -> validate tag/package -> npm ci -> check/unit/build
-> set up QEMU/Buildx -> login GHCR with GITHUB_TOKEN
-> build+push linux/amd64,linux/arm64 -> capture digest
-> attest OCI image -> generate manifest -> attest manifest
-> gh release create with update-manifest.json and generated notes
```

Use `docker/build-push-action`’s digest output, `actions/attest` for `subject-name` plus `subject-digest`, and a second `actions/attest` with `subject-path: update-manifest.json`. Pass `TOME_CMS_VERSION` and `TOME_CMS_COMMIT_SHA` as build args. Do not publish or use a mutable tag from the updater.

- [ ] **Step 5: Validate workflow and release generator**

```sh
node --import tsx --test tests/unit/release-manifest.test.ts tests/unit/update-contracts.test.ts
npm run check
npx --yes actionlint .github/workflows/release.yml
```

If `actionlint` is unavailable or its download is blocked, inspect `git diff --check`, parse the YAML with the existing system Ruby/Python YAML parser if installed, and record that live GitHub execution remains the release gate. Do not add `actionlint` as an application dependency.

- [ ] **Step 6: Commit the publisher**

```sh
git add scripts/release-manifest.ts tests/unit/release-manifest.test.ts .github/workflows/release.yml package.json package-lock.json
git diff --cached --check
git diff --cached --stat
git commit -m "ci(release): publish attested TomeCMS images"
```

### Task 6: Build the host updater’s config, state, process, and socket core

**Files:**

- Create: `src/updater/config.ts`
- Create: `src/updater/state.ts`
- Create: `src/updater/process.ts`
- Create: `src/updater/server.ts`
- Create: `src/updater/main.ts`
- Create: `tsconfig.updater.json`
- Create: `tests/unit/updater-config.test.ts`
- Create: `tests/unit/updater-state.test.ts`
- Create: `tests/unit/updater-server.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Task 1 stable-version parser and Node 22 standard library.
- Produces: `UpdaterConfig`, `parseUpdaterConfig()`, `UpdateJob`, `UpdaterStateStore`, `runCommand()`, `createUpdaterServer()`, compiled `dist-updater/` service.

- [ ] **Step 1: Write strict configuration tests**

Use a valid object copied from the spec. Assert exact keys, fixed project name, absolute allowlisted paths, loopback health URL, 5 GiB minimum, no symlink, and rejection of `/`, `..`, Docker socket, alternate project/image/repository values.

```ts
const config = parseUpdaterConfig(validConfig);
assert.equal(config.socketPath, '/run/tome-cms/updater.sock');
for (const invalid of [
  { ...validConfig, projectName: 'customer-input' },
  { ...validConfig, composeFile: '/tmp/compose.yaml' },
  { ...validConfig, socketPath: '/var/run/docker.sock' },
  { ...validConfig, appHealthUrl: 'https://evil.example/ready' },
]) assert.throws(() => parseUpdaterConfig(invalid));
```

- [ ] **Step 2: Write state-transition and atomic-write tests**

Define these exact phase types:

```ts
export type UpdatePhase =
  | 'preflight' | 'verifying' | 'downloading' | 'quiescing'
  | 'backing_up' | 'migrating' | 'restarting' | 'health_check'
  | 'rolling_back' | 'succeeded' | 'rolled_back' | 'failed_manual_recovery';
```

Tests use `mkdtemp()` and prove valid forward transitions, terminal immutability, exclusive active job, `0600` durable files, `0640` runtime status, exact-key parsing, and recovery from a truncated temporary file without replacing the last valid state.

- [ ] **Step 3: Write the socket protocol test**

Start `createUpdaterServer()` on a temporary Unix socket and assert:

```ts
assert.equal((await unixRequest(socket, 'GET', '/v1/status')).status, 200);
assert.equal((await unixRequest(socket, 'POST', '/v1/apply', {
  version: '1.0.1', requestId: crypto.randomUUID(),
})).status, 202);
assert.equal((await unixRequest(socket, 'POST', '/v1/apply', {
  version: 'latest', requestId: crypto.randomUUID(),
})).status, 400);
assert.equal((await unixRequest(socket, 'POST', '/v1/apply', {
  version: '1.0.1', requestId: crypto.randomUUID(), command: 'docker',
})).status, 400);
```

The injected apply callback records only `{ version, requestId }`; the server never accepts command metadata.

- [ ] **Step 4: Run all three files red**

```sh
node --import tsx --test tests/unit/updater-config.test.ts tests/unit/updater-state.test.ts tests/unit/updater-server.test.ts
```

- [ ] **Step 5: Implement the minimum host core**

Use these contracts:

```ts
export interface UpdaterConfig {
  configVersion: 1;
  projectName: 'tomecms';
  composeFile: string;
  environmentFile: string;
  imageEnvironmentFile: string;
  stateDirectory: string;
  backupDirectory: string;
  socketPath: string;
  statusPath: string;
  appHealthUrl: string;
  minimumFreeBytes: number;
}

export interface InstalledState {
  version: string;
  imageDigest: string;
  composeContract: 1;
  environmentContract: 1;
  updaterProtocol: 1;
  installedAt: string;
}

export interface UpdateJob {
  id: string;
  requestId: string;
  targetVersion: string;
  previousVersion: string;
  previousImageDigest: string;
  targetImageDigest: string | null;
  phase: UpdatePhase;
  completedSteps: number;
  totalSteps: 8;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  backupDirectory: string | null;
  backupCreatedAt: string | null;
}

export type PublicUpdateJob = Pick<UpdateJob,
  | 'id' | 'targetVersion' | 'phase' | 'completedSteps' | 'totalSteps'
  | 'message' | 'startedAt' | 'finishedAt' | 'errorCode' | 'backupCreatedAt'
>;

export interface UpdaterStateStore {
  readInstalled(): Promise<InstalledState>;
  writeInstalled(value: InstalledState): Promise<void>;
  readJob(): Promise<UpdateJob | null>;
  createJob(input: Pick<UpdateJob, 'requestId' | 'targetVersion'>): Promise<UpdateJob>;
  transitionJob(id: string, phase: UpdatePhase, patch?: Partial<Pick<UpdateJob,
    'targetImageDigest' | 'finishedAt' | 'errorCode' | 'backupDirectory' | 'backupCreatedAt'
  >>): Promise<UpdateJob>;
}

export function createUpdaterStateStore(config: UpdaterConfig): UpdaterStateStore;

export interface ApplyRequest { version: string; requestId: string }
export function createUpdaterServer(input: {
  state: UpdaterStateStore;
  apply: (request: ApplyRequest) => Promise<UpdateJob>;
}): import('node:http').Server;

export interface CommandResult { code: number; stdout: string; stderr: string }
export async function runCommand(executable: string, args: readonly string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number;
}): Promise<CommandResult>;
```

`runCommand()` uses `spawn()` with `shell: false`, caps each captured stream at 32 KiB, sends `SIGTERM` on timeout and `SIGKILL` five seconds later, and returns only bounded strings. Executable paths come from updater config/bootstrap, never a socket body.

State writes use an exclusive same-directory temporary file, `fsync`, `rename`, and directory `fsync`. The public status mirror omits paths, backup filenames, command output, and config.

- [ ] **Step 6: Add the dedicated compiler**

`tsconfig.updater.json` includes only `src/update/**/*.ts` and `src/updater/**/*.ts`, emits Node ESM to `dist-updater`, uses `NodeNext` resolution, strict mode, source maps off, declarations off, and no DOM library. Updater source imports local modules with `.js` extensions so emitted Node ESM resolves.

Add:

```json
"build:updater": "tsc -p tsconfig.updater.json"
```

Ignore `/dist-updater/`.

- [ ] **Step 7: Run and commit**

```sh
node --import tsx --test tests/unit/updater-config.test.ts tests/unit/updater-state.test.ts tests/unit/updater-server.test.ts
npm run build:updater
npm run check
git add src/updater src/update tests/unit/updater-config.test.ts tests/unit/updater-state.test.ts tests/unit/updater-server.test.ts tsconfig.updater.json package.json .gitignore
git diff --cached --check
git diff --cached --stat
git commit -m "feat(updater): add host service foundation"
```

### Task 7: Verify releases and preflight without mutating the host

**Files:**

- Create: `src/updater/verify.ts`
- Create: `tests/unit/updater-verify.test.ts`

**Interfaces:**

- Consumes: Task 1 manifest parser, Task 6 config/process/state, Task 3 release response rules.
- Produces: `VerifiedRelease`, `verifyTargetRelease()`, `runPreflight()`.

- [ ] **Step 1: Write the failing provenance/compatibility test**

Inject `fetcher`, `run`, `statfs`, current state, and host platform. Prove the successful order and rejection before Docker pull for each failure:

```ts
assert.deepEqual(events, [
  'github:release:v1.0.1', 'github:manifest', 'digest:manifest',
  'gh:manifest-attestation', 'manifest:parse', 'compatibility',
  'gh:image-attestation', 'disk', 'platform',
]);
```

Invalid cases must cover mutable release, asset digest mismatch, manifest attestation failure, image attestation failure, unsupported architecture, target not newer, installed version below direct floor, updater too old, rollback floor above installed version, contract mismatch, insufficient disk, and target migration mismatch.

- [ ] **Step 2: Run red**

```sh
node --import tsx --test tests/unit/updater-verify.test.ts
```

- [ ] **Step 3: Implement exact release verification**

Export:

```ts
export interface VerifiedRelease {
  manifest: UpdateManifest;
  manifestPath: string;
  imageReference: string;
}

export interface VerifyDependencies {
  fetcher: typeof fetch;
  runCommand: typeof import('./process.js').runCommand;
  statfs: typeof import('node:fs/promises').statfs;
  now: () => Date;
}

export async function verifyTargetRelease(input: {
  version: string;
  installed: InstalledState;
  updaterVersion: string;
  config: UpdaterConfig;
  dependencies?: VerifyDependencies;
}): Promise<VerifiedRelease>;

export async function runPreflight(input: {
  installed: InstalledState;
  target: UpdateManifest;
  updaterVersion: string;
  config: UpdaterConfig;
  dependencies?: VerifyDependencies;
}): Promise<void>;
```

The helper fetches `/releases/tags/v${version}` itself. Hash the downloaded manifest bytes with `createHash('sha256')`; compare to the release asset digest with equal-length `timingSafeEqual()`. Run:

```text
gh attestation verify <private-manifest-path> -R Dhanabhon/tome-cms
gh attestation verify oci://ghcr.io/dhanabhon/tome-cms@sha256:<digest> -R Dhanabhon/tome-cms
```

Use fixed argv and a private `mkdtemp()` directory removed in `finally`. Never pass browser strings except the already-parsed version segment.

- [ ] **Step 4: Implement bounded preflight**

`runPreflight()` checks fixed files without following symlinks, state/image agreement, `docker version`, `docker compose version`, `gh version`, Compose service health, host platform, and `statfs(backupDirectory)`. Reject if available bytes are below `minimumFreeBytes`.

Do not pull, stop, write maintenance state, back up, or migrate in this function.

- [ ] **Step 5: Run and commit**

```sh
node --import tsx --test tests/unit/updater-verify.test.ts
npm run build:updater
npm run check
git add src/updater/verify.ts tests/unit/updater-verify.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(updater): verify official update provenance"
```

### Task 8: Let the current app image create a managed direct backup

**Files:**

- Create: `tests/unit/backup-direct.test.ts`
- Modify: `scripts/backup.ts`
- Modify: `Dockerfile`

**Interfaces:**

- Consumes: Existing backup manifest/object mirroring and the managed container’s `DATABASE_URL`/S3 environment.
- Produces: `--direct`, `--json`, direct `pg_dump`, structured completion output.

- [ ] **Step 1: Write failing option and command tests**

Extend the pure option parser contract:

```ts
assert.deepEqual(parseBackupOptions([
  '--offline', '--direct', '--json', '--output-root', '/var/backups/tome-cms',
]), { offline: true, direct: true, json: true, outputRoot: '/var/backups/tome-cms' });
assert.throws(() => parseBackupOptions(['--direct', '--output-root', '/var/backups/tome-cms']), /offline/);
```

Extract a pure `directPgDumpInvocation(databaseUrl)` and assert that its argument URL contains no password while `PGPASSWORD` is supplied only in the child environment:

```ts
const invocation = directPgDumpInvocation('postgresql://tomecms:secret@postgres:5432/tomecms');
assert.doesNotMatch(invocation.args.join(' '), /secret/);
assert.equal(invocation.env.PGPASSWORD, 'secret');
```

The helper has this exact return contract:

```ts
export interface PgDumpInvocation {
  executable: 'pg_dump';
  args: string[];
  env: NodeJS.ProcessEnv;
}
export function directPgDumpInvocation(databaseUrl: string): PgDumpInvocation;
```

- [ ] **Step 2: Run red**

```sh
node --import tsx --test tests/unit/backup-direct.test.ts
```

- [ ] **Step 3: Add direct dump and structured output**

Preserve the existing host Compose behavior when `--direct` is absent. In direct mode:

- Refuse unless `--offline` is also present.
- Run the installed `pg_dump` binary directly against a credential-free URL and pass the password only via `PGPASSWORD`.
- Keep `--format=custom --no-owner --no-privileges`.
- Mirror S3 objects with the existing code.
- Write `manifest.json` last.
- With `--json`, print only:

```json
{"backupDirectory":"/var/backups/tome-cms/tomecms-20260920T100000000Z","manifestSha256":"<64 lowercase hex>"}
```

Human mode retains the current friendly output.

The runtime image must copy `scripts/backup.ts` and the existing `src/server/media/`, `src/server/db/`, and `src/server/env.ts` modules needed by that script. Keep the backup directory absent from the normal app service; the updater mounts it only into the one-shot backup container.

- [ ] **Step 4: Add `pg_dump` to the runtime image**

Before switching to the non-root user, add:

```dockerfile
RUN apk add --no-cache postgresql-client
```

Do not install Docker CLI or mount its socket in the image.

- [ ] **Step 5: Run and commit**

```sh
node --import tsx --test tests/unit/backup-direct.test.ts tests/operations/fresh-install.test.ts
npm run check
npm run build
git add scripts/backup.ts tests/unit/backup-direct.test.ts Dockerfile
git diff --cached --check
git diff --cached --stat
git commit -m "feat(backup): support managed update recovery points"
```

### Task 9: Execute the update transaction and image rollback

**Files:**

- Create: `src/updater/transaction.ts`
- Create: `tests/unit/updater-transaction.test.ts`
- Modify: `src/updater/server.ts`
- Modify: `src/updater/main.ts`

**Interfaces:**

- Consumes: Tasks 6–8 updater state/process/verification and direct backup command.
- Produces: `applyUpdate()`, boot reconciliation, real `/v1/apply` handler.

- [ ] **Step 1: Write the success-order test with injected dependencies**

Use a fake command runner and assert this exact externally visible sequence:

```ts
assert.deepEqual(events, [
  'state:preflight', 'preflight', 'state:verifying', 'verify',
  'state:downloading', 'docker:pull-target',
  'state:quiescing', 'status:maintenance', 'drain:2000', 'compose:stop-app',
  'state:backing_up', 'compose:backup-current', 'backup:validate',
  'image-env:target', 'state:migrating', 'compose:migrate-target',
  'state:restarting', 'compose:start-target', 'state:health_check', 'health:target',
  'installed:target', 'state:succeeded',
]);
```

Assert `installed.json` changes only after target readiness and the backup directory remains recorded in private job state.

- [ ] **Step 2: Write three failure tests before implementation**

Prove:

1. Verification/pull failure leaves the app and installed state untouched.
2. Backup failure restarts the previous image without running migration.
3. Post-migration health failure restores the previous digest only when `rollbackSafeFrom <= previousVersion`; otherwise it reaches `failed_manual_recovery` and does not run a down migration.

Also simulate rollback readiness failure and assert the same manual-recovery terminal state.

- [ ] **Step 3: Run red**

```sh
node --import tsx --test tests/unit/updater-transaction.test.ts
```

- [ ] **Step 4: Implement one transaction with fixed commands**

Export:

```ts
export async function applyUpdate(input: {
  version: string;
  requestId: string;
  updaterVersion: string;
  config: UpdaterConfig;
  state: UpdaterStateStore;
  dependencies?: UpdateDependencies;
}): Promise<UpdateJob>;

export interface UpdateDependencies {
  runCommand: typeof import('./process.js').runCommand;
  verifyTargetRelease: typeof import('./verify.js').verifyTargetRelease;
  runPreflight: typeof import('./verify.js').runPreflight;
  fetcher: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
}
```

Use fixed Compose prefix arguments:

```ts
const compose = [
  'compose', '-p', 'tomecms', '-f', config.composeFile,
  '--env-file', config.environmentFile,
  '--env-file', config.imageEnvironmentFile,
] as const;
```

Commands are exactly:

```text
docker pull <official-image@digest>
docker compose ... stop --timeout 30 app
docker compose ... run --rm --no-deps --user <updater-uid>:<updater-gid> --volume /var/backups/tome-cms:/backups app npm run backup -- --offline --direct --json --output-root /backups
docker compose ... run --rm --no-deps app npm run db:migrate
docker compose ... up -d --no-deps --wait --wait-timeout 90 app
```

Resolve `<updater-uid>:<updater-gid>` from `process.getuid()`/`process.getgid()` and reject UID `0`; neither value comes from the socket. Use timeouts from the spec. Parse the bounded backup JSON with exact keys, resolve the returned directory under the configured backup root, hash its regular `manifest.json`, and require the reported SHA-256, `format: tomecms-backup`, `version: 1`, and installed `applicationVersion` before writing target `image.env`. The trusted backup process already validates the complete manifest with its existing Zod schema. Write `image.env` atomically and allow only `TOME_CMS_APP_IMAGE='ghcr.io/dhanabhon/tome-cms@sha256:…'` plus newline.

- [ ] **Step 5: Add startup reconciliation**

On service start, when `job.json` has a non-terminal phase, compare the configured image, running app image, and readiness:

- Target running and ready: commit target installed state and mark success.
- Previous running and ready: mark rolled back.
- Neither: mark manual recovery and refuse apply.

Do not infer success from a container name alone.

- [ ] **Step 6: Wire the socket apply callback and commit**

The server creates the job synchronously, returns `202`, and runs the transaction without holding the HTTP response. An in-memory promise plus the durable non-terminal state rejects concurrent requests.

```sh
node --import tsx --test tests/unit/updater-transaction.test.ts tests/unit/updater-server.test.ts
npm run build:updater
npm run check
git add src/updater/transaction.ts tests/unit/updater-transaction.test.ts src/updater/server.ts src/updater/main.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(updater): apply and roll back app updates"
```

---

## Milestone 3: Managed VPS integration

### Task 10: Bridge the managed updater with fresh Passkey verification and write quiescing

**Files:**

- Create: `src/server/update/updater-client.ts`
- Create: `src/server/auth/fresh-session.ts`
- Create: `src/server/update/maintenance.ts`
- Create: `tests/unit/update-updater-client.test.ts`
- Create: `tests/unit/update-maintenance.test.ts`
- Modify: `src/pages/api/admin/system/updates.ts`
- Modify: `src/pages/api/admin/security/recovery-codes.ts`
- Modify: `src/components/admin/UpdateManager.tsx`
- Modify: `src/middleware.ts`

**Interfaces:**

- Consumes: Task 9 socket protocol, existing Better Auth session credential, origin/rate-limit/error helpers, and UI from Task 4.
- Produces: `getUpdaterStatus()`, `requestUpdate()`, `requireFreshOwnerSession()`, mutation maintenance barrier, live Install/progress UI.

- [ ] **Step 1: Extract and test the shared fresh-session gate**

Move the current five-minute SQL check out of `recovery-codes.ts` into:

```ts
export const FRESH_SESSION_SECONDS = 5 * 60;
export async function requireFreshOwnerSession(current: OwnerSession): Promise<void>;
```

It must match session ID, token, user ID, unexpired time, and `createdAt >= CURRENT_TIMESTAMP - 5 minutes`. Keep recovery-code behavior unchanged and reuse the function from both routes.

- [ ] **Step 2: Write the Unix client’s failing tests**

Start a temporary Unix HTTP server. Prove successful GET/apply, 4 KiB response cap, two-second request timeout, strict response phase parsing, missing socket mapped to `managed: false`, and no fallback to TCP/Docker.

```ts
const status = await getUpdaterStatus({ socketPath, timeoutMs: 2_000 });
assert.equal(status.managed, true);
await requestUpdate({ socketPath, version: '1.0.1', requestId: crypto.randomUUID() });
assert.deepEqual(receivedBody, { version: '1.0.1', requestId });
```

- [ ] **Step 3: Write the maintenance parser test**

Use a temporary file and prove only `quiescing`, `backing_up`, `migrating`, `restarting`, and `health_check` block writes. Missing/malformed files fail open for normal CMS availability but return `managed: false` to the update page.

- [ ] **Step 4: Implement the server bridge**

In managed mode, `GET /api/admin/system/updates` combines cached release state with `GET /v1/status`. In check-only mode it never opens the socket.

For `POST { action: 'apply', version }`:

1. Same-origin check.
2. Installed-owner check.
3. `update-apply` rate limit.
4. `requireFreshOwnerSession()`.
5. Re-fetch/compare the cached official latest version.
6. Confirm updater protocol/version/capability.
7. Forward only version and request ID.
8. Return `202` with sanitized job.

Never forward a manifest, URL, digest, cookie, session token, or client address.

- [ ] **Step 5: Block writes centrally during maintenance**

In `src/middleware.ts`, before dispatching non-safe `/api/admin/` requests, call `isUpdateWriteBlocked()` only when `TOME_CMS_UPDATE_MODE === 'managed'`. Return:

```ts
return Response.json({ error: 'TomeCMS is installing an update. Try again shortly.' }, {
  status: 503,
  headers: { 'Cache-Control': 'no-store', 'Retry-After': '10' },
});
```

Exclude `/api/admin/system/updates` so status polling and the initial apply request work. Safe `GET`/`HEAD` requests remain available until the app stops.

- [ ] **Step 6: Add confirmation, Passkey, progress, and reconnect behavior**

On Install:

1. Show the existing accessible `confirmUi()` dialog with target version, backup, and brief restart copy.
2. Call `authClient.signIn.passkey()`.
3. POST the exact version.
4. Poll GET every second while connected.
5. On fetch failure, show `Reconnecting…` and back off `1, 2, 4, 8, 10` seconds.
6. Stop only on a terminal updater phase or component unmount.

Render eight named steps, `aria-current="step"`, completed markers, and `<progress max={8} value={completedSteps}>`. Do not infer failure from temporary network loss.

- [ ] **Step 7: Run and commit**

```sh
node --import tsx --test tests/unit/update-updater-client.test.ts tests/unit/update-maintenance.test.ts
npm run check
npm run build
git add src/server/update/updater-client.ts src/server/auth/fresh-session.ts src/server/update/maintenance.ts tests/unit/update-updater-client.test.ts tests/unit/update-maintenance.test.ts src/pages/api/admin/system/updates.ts src/pages/api/admin/security/recovery-codes.ts src/components/admin/UpdateManager.tsx src/middleware.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(admin): apply verified managed updates"
```

### Task 11: Install the managed Compose and systemd runtime on fresh VPS hosts

**Files:**

- Create: `compose.managed.yaml`
- Create: `config/systemd/tomecms-updater.service`
- Create: `scripts/install-managed-vps.sh`
- Create: `tests/unit/managed-installer.test.ts`
- Modify: `scripts/deploy-vps.sh`
- Modify: `scripts/bootstrap-core.mjs`
- Modify: `tests/unit/bootstrap-core.test.ts`
- Modify: `.dockerignore`
- Modify: `README.md`

**Interfaces:**

- Consumes: compiled updater, release manifest, existing environment generation, PostgreSQL/SeaweedFS services, migration and readiness endpoints.
- Produces: fixed managed filesystem, service account/group/socket, managed Compose project, initial installed state, `TOME_CMS_UPDATE_MODE=managed`.

- [ ] **Step 1: Write the installer dry-run test**

Make `scripts/install-managed-vps.sh --dry-run --version 1.0.0` print one JSON plan without mutation. Test the exact destination list, mode, user/group, and command order. Reject non-Linux, non-root execution mode, version mismatch, missing `docker`/Compose/`gh`, symlink destinations, non-empty unmanaged destinations, unsupported architecture, and a private/unverifiable release.

The test runs with stub executables and a temporary root prefix; it must never call the host’s real `sudo`, `systemctl`, Docker, or GitHub.

- [ ] **Step 2: Create the managed Compose contract**

`compose.managed.yaml` keeps the existing PostgreSQL and SeaweedFS images/volumes and changes only app delivery:

```yaml
app:
  image: ${TOME_CMS_APP_IMAGE:?TOME_CMS_APP_IMAGE must be an official digest}
  env_file:
    - /etc/tome-cms/tome-cms.env
  environment:
    DATABASE_URL: postgresql://tomecms:${POSTGRES_PASSWORD}@postgres:5432/tomecms
    NODE_ENV: production
    TOME_CMS_UPDATE_MODE: managed
    TOME_CMS_UPDATER_SOCKET: /run/tome-cms/updater.sock
  volumes:
    - /run/tome-cms:/run/tome-cms
  group_add:
    - ${TOME_CMS_UPDATER_GID:?TOME_CMS_UPDATER_GID is required}
  depends_on:
    postgres: { condition: service_healthy }
    seaweedfs: { condition: service_healthy }
  ports: ["127.0.0.1:${APP_PORT:-4321}:4321"]
```

Do not add a Docker socket volume. Keep the fixed `tomecms` project and existing named data volumes.

- [ ] **Step 3: Create the hardened systemd unit**

The unit uses:

```ini
[Service]
Type=simple
User=tomecms-updater
Group=tomecms-updater
SupplementaryGroups=docker
ExecStart=/usr/bin/node /opt/tome-cms/updater/updater/main.js --config /etc/tome-cms/updater.json
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/tome-cms /var/backups/tome-cms /run/tome-cms
```

Use `RuntimeDirectory=tome-cms`, `StateDirectory=tome-cms`, and `LogsDirectory=tome-cms` when the target systemd version supports them; the installer creates and verifies the exact directories regardless. The service must have no inbound TCP listener.

- [ ] **Step 4: Implement a fresh-install-only managed installer**

The script must:

1. Require Linux, Node 22+, Docker/Compose, GitHub CLI, root/sudo, and public release access.
2. Build `dist-updater` from the checked-out matching stable tag.
3. Fetch and verify that tag’s immutable manifest and both attestations.
4. Pull the exact app digest.
5. Create the dedicated user/group, write its numeric group ID as `TOME_CMS_UPDATER_GID`, and add that supplemental group to only the app container.
6. Install files under `/opt`, `/etc`, `/var/lib`, `/var/backups`, and `/run` with the spec modes.
7. Reuse `bootstrap-core.mjs` environment generation but write the production environment to `/etc/tome-cms/tome-cms.env`, never `.env.local`.
8. Write `image.env` and initial `installed.json` atomically.
9. Start pinned PostgreSQL/SeaweedFS, run target migrations, start the app, and wait for readiness.
10. Enable/start `tomecms-updater.service` and verify `/v1/status` over the socket.
11. Print only the installer URL, installation token location command, current version, and backup directory.

If any step before migrations fails, remove only newly created empty config/runtime files and leave Docker data untouched. If migrations or readiness fail, retain config, volumes, image, and logs and print the manual recovery command; do not run a destructive cleanup.

- [ ] **Step 5: Keep local/source bootstrap unchanged**

`npm run dev:macos`, `npm run dev:windows`, `npm run bootstrap:core`, and `compose.yaml` remain check-only/build-based. `scripts/deploy-vps.sh` delegates to the managed installer only for the tagged `1.0.0+` production path.

Add tests proving local generated env still defaults to:

```dotenv
TOME_CMS_UPDATE_MODE=check-only
```

and managed production generates:

```dotenv
TOME_CMS_UPDATE_MODE=managed
TOME_CMS_UPDATER_SOCKET=/run/tome-cms/updater.sock
```

- [ ] **Step 6: Document the boundary and manual transition**

README must explain:

- Public repo/immutable release prerequisite.
- Managed fresh install command and required GitHub CLI.
- Why local/source installs are check-only.
- Why Docker socket is never mounted into Astro.
- Filesystem/backup locations.
- Pre-`1.0.0` manual transition rather than an in-place web update.
- `systemctl status tomecms-updater`, socket status check, journald command, and manual recovery entry point.

- [ ] **Step 7: Run and commit**

```sh
node --import tsx --test tests/unit/managed-installer.test.ts tests/unit/bootstrap-core.test.ts
bash -n scripts/install-managed-vps.sh scripts/deploy-vps.sh scripts/dev-local-macos.sh
npm run build:updater
npm run check
git add compose.managed.yaml config/systemd/tomecms-updater.service scripts/install-managed-vps.sh tests/unit/managed-installer.test.ts scripts/deploy-vps.sh scripts/bootstrap-core.mjs tests/unit/bootstrap-core.test.ts .dockerignore README.md
git diff --cached --check
git diff --cached --stat
git commit -m "feat(deploy): install managed TomeCMS updater"
```

### Task 12: Prove the `1.0.0 → 1.0.1` recovery contract and publish operations docs

**Files:**

- Create: `tests/operations/managed-update.test.ts`
- Create: `docs/releases/1.0.0.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: complete managed installer/update path.
- Produces: disposable end-to-end operation check, release gates, operator recovery instructions.

- [ ] **Step 1: Add the operations script before the test**

Add:

```json
"test:operations:update": "node --import tsx --test tests/operations/managed-update.test.ts"
```

- [ ] **Step 2: Write the disposable operations test**

The test uses a unique Compose project, temporary config/state/backup roots, stubbed GitHub release responses, locally built `1.0.0` and `1.0.1` fixture images, and the real Unix updater service. It must assert:

1. Check-only mode never opens the updater socket.
2. Managed status reports `1.0.0`.
3. A bad manifest digest and bad attestation fail before app stop.
4. Successful apply creates a complete backup, runs migrations once, and reports ready `1.0.1`.
5. A target health failure restores the `1.0.0` digest and reports `rolled_back`.
6. A rollback-incompatible manifest is rejected during preflight.
7. PostgreSQL and SeaweedFS container image IDs and volume IDs do not change.
8. The public `/api/v1/content/site` response and Headless mode behavior remain unchanged.

Always remove the unique containers/networks/volumes and temporary files in `test.after()`. Refuse to run if the project name or paths do not start with the test prefixes.

- [ ] **Step 3: Run the smallest complete automated gate**

```sh
npm run test:unit
npm run test:operations:update
npm run check
npm run build
```

Expected: all pass; no real production project, volume, config, or backup path is touched.

- [ ] **Step 4: Perform the two real-host release candidates**

On disposable Ubuntu hosts, run one acceptance on `linux/amd64` and one on `linux/arm64`:

```text
fresh managed 1.0.0 install
-> complete browser Wizard and Passkey enrollment over HTTPS
-> create one Post, Page, Category, Navigation item, and media object
-> create an operator backup and verify it in a disposable restore project
-> publish/install 1.0.1 candidate
-> verify Admin, bundled Blog or Headless API, media, and updater history
-> repeat with an intentionally unhealthy target and confirm image rollback
```

Record image digests, migration key, backup manifest hash, updater version, architecture, and readiness outcome in the release checklist. Never record secrets or Passkey material.

- [ ] **Step 5: Document recovery commands and release boundaries**

`docs/releases/1.0.0.md` and README must state:

- First supported web path is `1.0.0 → 1.0.1`.
- Pre-`1.0.0` needs manual transition.
- App rollback is automatic only when declared schema-compatible.
- Database/object restore is manual and uses the retained update backup.
- Updater self-update and infrastructure update are manual.
- Automatic updates, beta channel, and backup pruning are absent from `1.0.0`.

- [ ] **Step 6: Run the final secret/scope audit and commit**

```sh
git status --short
git diff --check
rg -n '(ghp_|github_pat_|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|POSTGRES_PASSWORD=.+'"'"'[^$<{]|S3_SECRET_ACCESS_KEY=.+'"'"'[^$<{])' --glob '!package-lock.json' .
git add tests/operations/managed-update.test.ts docs/releases/1.0.0.md README.md package.json package-lock.json
git diff --cached --check
git diff --cached --stat
git commit -m "test(updates): verify managed update recovery"
```

Review every secret-scan match manually; committed variable names and obvious test-only values are acceptable, real credentials are not.

## Plan Self-Review Checklist

- [ ] Every goal and acceptance criterion in the spec maps to at least one task.
- [ ] No task accepts a repository, image, URL, path, command, or digest from the browser.
- [ ] Check-only ships before Docker authority exists.
- [ ] The app never mounts or connects to the Docker socket.
- [ ] The updater independently verifies the immutable release, manifest digest, manifest attestation, image attestation, image digest, platform, version, migration, and contract values.
- [ ] A complete backup is validated before target image selection or migration.
- [ ] Every post-migration failure has a tested compatible rollback or manual-recovery branch.
- [ ] `1.x` migrations obey expand/contract and never automatically run down.
- [ ] Application updates leave PostgreSQL and SeaweedFS images/volumes unchanged.
- [ ] Restart-tolerant status contains no raw logs or secrets.
- [ ] Local, Windows, macOS, and source Compose workflows remain check-only and otherwise unchanged.
- [ ] Bundled and Headless modes preserve public zero-JS/API behavior.
- [ ] Generated artifacts and real credentials remain ignored.
