# Headless Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the PostgreSQL, Kysely, Docker Compose, environment, migration, health-check, and test foundations required by the Supabase-free TomeCMS runtime without switching existing CMS traffic yet.

**Architecture:** A single `pg.Pool` is shared by Kysely and, in the next plan, Better Auth. Explicit TypeScript migrations own all DDL. One Compose topology supplies PostgreSQL and MinIO locally and adds the Astro application only in the production profile. Runtime configuration is parsed once in server-only code; browser bundles never see database or object-store credentials.

**Tech Stack:** Astro 5 standalone Node SSR, Node.js 22, TypeScript strict mode, PostgreSQL 17, Kysely, `pg`, Docker Compose, MinIO, Node test runner.

**Spec:** [`docs/specs/2026-09-08-headless-core-migration-design.md`](../specs/2026-09-08-headless-core-migration-design.md)

## Global Constraints

- Run commands directly; do not use RTK.
- Execute this plan in a new isolated worktree created from the commit containing the approved design and completed Category work. Do not implement in a dirty checkout.
- Keep Astro 5, React 18, Tailwind 3, Novel 1.0.2, and the existing public URL structure unchanged.
- Do not add a repository interface, provider factory, ORM model layer, Redis, background worker, or runtime DDL.
- PostgreSQL is the only SQL target. MinIO is the default S3-compatible target, not a special storage implementation.
- Do not deploy the archived `minio/minio` OSS image. Pin a supported MinIO AIStor Free release and treat its local license file as an installation prerequisite; the license stays ignored and outside the application image.
- Do not remove or change the active Supabase runtime in this plan. This plan adds the replacement foundation alongside it so existing behavior remains usable until cutover.
- Never expose `DATABASE_URL`, Better Auth secrets, installation secrets, recovery peppers, S3 credentials, or signed URLs in public configuration or logs.
- Use TDD for each non-trivial unit: write the smallest failing test, run it red for the intended reason, implement the minimum code, and rerun it green.
- Stage only files named by the current task. Before every commit run `git diff --cached --check`, inspect `git diff --cached --stat`, and scan `git diff --cached` for credentials.

## Plan Sequence

This is plan 1 of 5. Complete in order:

1. Headless Core Foundation
2. Passkey Auth and Installer
3. PostgreSQL Content Migration
4. S3 File Manager
5. Headless API and Supabase Cutover

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| Runtime packages | none | `package.json`, `package-lock.json` |
| Environment | `src/server/env.ts`, `tests/unit/env.test.ts` | `.env.example`, `.gitignore` |
| Database | `src/server/db/client.ts`, `src/server/db/types.ts`, `src/server/db/migrator.ts`, `src/server/db/migrations/001_system.ts`, `scripts/db-migrate.ts`, `tests/unit/db-migrator.test.ts` | none |
| Containers | `compose.yaml`, `compose.test.yaml`, `Dockerfile`, `.dockerignore`, `scripts/bootstrap-core.mjs`, `tests/unit/bootstrap-core.test.ts` | `package.json` |
| Health | `src/server/health.ts`, `src/pages/health/live.ts`, `src/pages/health/ready.ts`, `tests/integration/foundation.test.ts` | none |
| Documentation | none | `README.md` |

---

## Task 1: Pin the replacement foundation and add the unit-test runner

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Record the current baseline**

Run:

```sh
npm run check
npm run build
```

Expected: both commands pass before dependency changes. Record unrelated failures in the task log instead of weakening checks.

- [ ] **Step 2: Install only the foundation packages**

Run:

```sh
npm install kysely pg
npm install --save-dev @types/pg tsx
```

Do not install a second environment parser, migration framework, test framework, logger, or Docker wrapper. Zod 4 and Node's built-in test runner already cover those needs.

- [ ] **Step 3: Add focused scripts**

Add these scripts without deleting the existing Supabase scripts yet:

```json
{
  "db:migrate": "node --env-file-if-exists=.env.local --import tsx scripts/db-migrate.ts",
  "infra:up": "docker compose --env-file .env.local up -d postgres minio minio-init",
  "infra:down": "docker compose --env-file .env.local down",
  "test:unit": "node --import tsx --test \"tests/unit/**/*.test.ts\"",
  "test:integration:foundation": "docker compose -f compose.test.yaml up -d --wait && node --env-file=.env.test --import tsx --test tests/integration/foundation.test.ts"
}
```

The integration cleanup command is added in Task 5 after the test topology exists.

- [ ] **Step 4: Verify dependency resolution and the unchanged app**

Run:

```sh
npm ls kysely pg tsx @types/pg
npm run check
npm run build
```

Expected: one resolved version of each direct dependency; existing app still checks and builds.

- [ ] **Step 5: Commit the foundation dependencies**

```sh
git add package.json package-lock.json
git diff --cached --check
git diff --cached --stat
git diff --cached | rg -n '(password|secret|token|access[_-]?key)\s*[=:]\s*[^$<{]'
git commit -m "build(core): add postgres foundation dependencies"
```

The secret scan should return no credential value; dependency names and environment variable names are acceptable after manual review.

## Task 2: Parse and protect the server environment

**Files:**

- Create: `src/server/env.ts`
- Create: `tests/unit/env.test.ts`
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing environment contract test**

Create `tests/unit/env.test.ts` against an exported pure parser:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseServerEnv } from '../../src/server/env';

const valid = {
  DATABASE_URL: 'postgresql://tomecms:password@127.0.0.1:5432/tomecms',
  TOME_CMS_PUBLIC_URL: 'https://cms.example.com',
  TOME_CMS_INSTALL_TOKEN: 'i'.repeat(32),
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  TOME_CMS_CONTEXT_SECRET: 'c'.repeat(32),
  TOME_CMS_RECOVERY_PEPPER: 'r'.repeat(32),
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'tomecms',
  S3_SECRET_ACCESS_KEY: 's'.repeat(24),
  S3_BUCKET: 'tomecms-media',
  MEDIA_PUBLIC_URL: 'http://127.0.0.1:9000/tomecms-media/',
};

test('accepts the canonical self-hosted environment', () => {
  assert.equal(parseServerEnv(valid).DATABASE_POOL_MAX, 10);
  assert.equal(parseServerEnv(valid).TOME_CMS_FRONTEND_MODE, 'bundled');
});

test('rejects missing secrets, malformed URLs, and production HTTP', () => {
  assert.throws(() => parseServerEnv({ ...valid, DATABASE_URL: '' }));
  assert.throws(() => parseServerEnv({ ...valid, NODE_ENV: 'production', TOME_CMS_PUBLIC_URL: 'http://cms.example.com' }));
  assert.throws(() => parseServerEnv({ ...valid, NODE_ENV: 'production', S3_ENDPOINT: 'http://minio:9000' }));
  assert.throws(() => parseServerEnv({ ...valid, S3_BUCKET: '../media' }));
});
```

- [ ] **Step 2: Run the test red**

```sh
npm run test:unit -- tests/unit/env.test.ts
```

Expected: FAIL because `src/server/env.ts` does not exist.

- [ ] **Step 3: Implement one strict parser and one lazy runtime accessor**

Export these exact contracts from `src/server/env.ts`:

```ts
import { z } from 'zod';

const secret = z.string().min(32);
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  TOME_CMS_PUBLIC_URL: z.url({ protocol: /^https?:$/ }),
  TOME_CMS_INSTALL_TOKEN: secret,
  BETTER_AUTH_SECRET: secret,
  TOME_CMS_CONTEXT_SECRET: secret,
  TOME_CMS_RECOVERY_PEPPER: secret,
  S3_ENDPOINT: z.url({ protocol: /^https?:$/ }),
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(8),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MEDIA_PUBLIC_URL: z.url({ protocol: /^https?:$/ }),
  TOME_CMS_FRONTEND_MODE: z.enum(['bundled', 'headless']).default('bundled'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && new URL(value.TOME_CMS_PUBLIC_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['TOME_CMS_PUBLIC_URL'], message: 'Production requires HTTPS.' });
  }
  if (value.NODE_ENV === 'production' && new URL(value.S3_ENDPOINT).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'Production signed uploads require a public HTTPS S3 endpoint.' });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export function parseServerEnv(input: NodeJS.ProcessEnv | Record<string, string | undefined>): ServerEnv;
export function getServerEnv(): ServerEnv;
```

`getServerEnv()` may cache one successful parse in production. Tests must call the pure `parseServerEnv()` function. Do not export the parsed object through an Astro `PUBLIC_` variable.

- [ ] **Step 4: Document names without committing values**

Add the variables above plus the Compose-only `POSTGRES_PASSWORD` and `MINIO_LICENSE_FILE` paths to `.env.example` with obvious non-secret placeholders. `MINIO_LICENSE_FILE` must point to a readable AIStor Free license outside the repository. Ensure `.env`, `.env.*`, `.env.local`, `.env.test`, license files, MinIO data, PostgreSQL data, and Compose override files remain ignored while `.env.example` remains tracked.

- [ ] **Step 5: Run and commit**

```sh
npm run test:unit -- tests/unit/env.test.ts
npm run check
git add src/server/env.ts tests/unit/env.test.ts .env.example .gitignore
git diff --cached --check
git diff --cached --stat
git commit -m "feat(core): validate server runtime environment"
```

## Task 3: Add the shared database client and explicit migrator

**Files:**

- Create: `src/server/db/types.ts`
- Create: `src/server/db/client.ts`
- Create: `src/server/db/migrator.ts`
- Create: `src/server/db/migrations/001_system.ts`
- Create: `scripts/db-migrate.ts`
- Create: `tests/unit/db-migrator.test.ts`

- [ ] **Step 1: Write the failing migration ordering test**

Test the exported migration map without opening a socket:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { migrations } from '../../src/server/db/migrator';

test('ships ordered, uniquely named forward migrations', () => {
  const names = Object.keys(migrations);
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
  assert.match(names[0] ?? '', /^001_/);
});
```

- [ ] **Step 2: Run it red**

```sh
npm run test:unit -- tests/unit/db-migrator.test.ts
```

Expected: FAIL because the migrator is absent.

- [ ] **Step 3: Define the database type and reuse one pool**

Start with the system table only; later plans extend `Database` through concrete table interfaces:

```ts
import type { ColumnType } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface AppMetadataTable {
  key: string;
  value: string;
  updated_at: Timestamp;
}

export interface Database {
  app_metadata: AppMetadataTable;
}
```

`src/server/db/client.ts` must export `pool`, `db`, and `closeDatabase()`. Use one `pg.Pool` and `new PostgresDialect({ pool })`; cache the pair on `globalThis` only in development so Astro HMR does not leak pools. Do not wrap Kysely in a custom repository class.

- [ ] **Step 4: Add an in-code migration provider**

Export a real migration object and functions from `src/server/db/migrator.ts`:

```ts
import { Migrator } from 'kysely';

import { db } from './client';
import * as system from './migrations/001_system';

export const migrations = { '001_system': system } as const;

export async function migrateToLatest(): Promise<void>;
export async function pendingMigrationNames(): Promise<string[]>;
```

Use Kysely's `MigrationProvider` interface over the static object. `migrateToLatest()` must throw with the migration name and direction when any result contains an error. `pendingMigrationNames()` must compare the provider keys to the names returned by `migrator.getMigrations()` and must not run DDL.

`001_system.ts` creates `app_metadata(key text primary key, value text not null, updated_at timestamptz not null default now())` and inserts `schema_version = 1`. Its `down()` removes only this table; production scripts never call down migrations.

- [ ] **Step 5: Add the explicit CLI**

`scripts/db-migrate.ts` must call `migrateToLatest()`, print only migration names/status, close the pool in `finally`, and exit non-zero on failure. It must never print `DATABASE_URL`.

- [ ] **Step 6: Run and commit**

```sh
npm run test:unit -- tests/unit/db-migrator.test.ts
npm run check
git add src/server/db scripts/db-migrate.ts tests/unit/db-migrator.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(core): add explicit postgres migrations"
```

## Task 4: Add local and production container topology

**Files:**

- Create: `compose.yaml`
- Create: `compose.test.yaml`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `scripts/bootstrap-core.mjs`
- Create: `tests/unit/bootstrap-core.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing bootstrap option test**

Export pure `parseOptions(args)` and `renderEnvironment(values)` functions from `scripts/bootstrap-core.mjs`. Test that default mode is local, `--production` selects the production profile, unknown flags fail, required values including an absolute `MINIO_LICENSE_FILE` are rendered once, and an existing environment file is never overwritten unless `--force` is supplied.

- [ ] **Step 2: Run it red**

```sh
npm run test:unit -- tests/unit/bootstrap-core.test.ts
```

- [ ] **Step 3: Add the Compose topology**

`compose.yaml` must define exactly these services:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: tomecms
      POSTGRES_USER: tomecms
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tomecms -d tomecms"]
      interval: 3s
      timeout: 3s
      retries: 20
    volumes: ["postgres-data:/var/lib/postgresql/data"]
    ports: ["127.0.0.1:${POSTGRES_PORT:-5432}:5432"]
  minio:
    image: quay.io/minio/aistor/minio:RELEASE.2026-08-07T18-34-35Z
    command: server /data --console-address :9001 --license /minio.license
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY_ID}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_ACCESS_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 3s
      timeout: 3s
      retries: 20
    volumes: ["minio-data:/data"]
    configs:
      - source: minio-license
        target: /minio.license
    ports: ["127.0.0.1:${MINIO_PORT:-9000}:9000", "127.0.0.1:${MINIO_CONSOLE_PORT:-9001}:9001"]
  minio-init:
    image: quay.io/minio/aistor/mc:RELEASE.2026-03-12T04-18-55Z
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: ["/bin/sh", "-c"]
    command: ["mc alias set local http://minio:9000 $$S3_ACCESS_KEY_ID $$S3_SECRET_ACCESS_KEY && mc mb --ignore-existing local/$$S3_BUCKET && mc anonymous set download local/$$S3_BUCKET"]
    environment:
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
      S3_BUCKET: ${S3_BUCKET}
  app:
    profiles: ["production"]
    build: .
    env_file: .env.local
    depends_on:
      postgres: { condition: service_healthy }
      minio-init: { condition: service_completed_successfully }
    ports: ["127.0.0.1:${APP_PORT:-4321}:4321"]
volumes:
  postgres-data:
  minio-data:
configs:
  minio-license:
    file: ${MINIO_LICENSE_FILE}
```

Verify the pinned AIStor tags and license behavior before committing. If a newer security release is selected, record the exact tested tags for both server and client. Do not use `latest`, the archived `minio/minio` image, or an unlicensed server that enters offline/read-only mode.

`compose.test.yaml` uses the same pinned images, different host ports, `tmpfs` storage, a distinct bucket, and no `app` service. It receives an explicit readable test-license path; the test harness fails before startup when that prerequisite is absent. Tests may destroy that project by its explicit Compose project name.

- [ ] **Step 4: Add the production image**

Use a two-stage `node:22-alpine` Dockerfile: `npm ci` plus build in the builder, then `npm ci --omit=dev --ignore-scripts` and copy `dist` into a non-root runtime. Add a container health check against `/health/live`. Do not bundle `.env*`, `.git`, tests, docs, Supabase working data, or local volumes.

- [ ] **Step 5: Add an idempotent core bootstrap**

`scripts/bootstrap-core.mjs` must use Node stdlib only to:

1. verify Node 22+, Docker, Compose, ports, and a readable `MINIO_LICENSE_FILE` outside the repository;
2. create `.env.local` with mode `0600` only when absent;
3. generate secrets with `randomBytes(32).toString('base64url')`;
4. run `docker compose --env-file .env.local up -d --wait postgres minio minio-init`;
5. run `npm run db:migrate`;
6. print the Installer URL and installation token without writing either into shell history.

The production option adds `--profile production app`; it does not configure TLS or open firewall ports.

- [ ] **Step 6: Run, validate, and commit**

```sh
npm run test:unit -- tests/unit/bootstrap-core.test.ts
MINIO_LICENSE_FILE=/dev/null docker compose --env-file .env.example config --quiet
MINIO_LICENSE_FILE=/dev/null docker compose -f compose.test.yaml config --quiet
docker build -t tomecms-plan-foundation .
git add compose.yaml compose.test.yaml Dockerfile .dockerignore scripts/bootstrap-core.mjs tests/unit/bootstrap-core.test.ts package.json package-lock.json
git diff --cached --check
git diff --cached --stat
git commit -m "feat(ops): add postgres and minio topology"
```

## Task 5: Add liveness, readiness, and real infrastructure verification

**Files:**

- Create: `src/server/health.ts`
- Create: `src/pages/health/live.ts`
- Create: `src/pages/health/ready.ts`
- Create: `tests/integration/foundation.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing integration test**

The test must start from migrated disposable services and assert:

- PostgreSQL accepts `select 1` through Kysely.
- `pendingMigrationNames()` returns `[]` after `migrateToLatest()`.
- the configured S3 bucket accepts a bounded `HeadBucket` request once the AWS package is introduced in Plan 4; until then readiness reports the storage check as `deferred`, not healthy.
- the readiness serializer returns only `{ status, checks }`, never connection strings or credentials.

- [ ] **Step 2: Implement bounded health functions**

Export:

```ts
export interface ReadinessResult {
  status: 'ready' | 'not-ready';
  checks: {
    database: 'ready' | 'unavailable';
    migrations: 'ready' | 'pending' | 'unavailable';
    storage: 'deferred' | 'ready' | 'unavailable';
  };
}

export async function checkReadiness(signal?: AbortSignal): Promise<ReadinessResult>;
```

Use `AbortSignal.timeout(2_000)` at the route boundary. `/health/live` always returns `200` with `{ status: 'live' }`. `/health/ready` returns `200` only when all non-deferred checks are ready, otherwise `503`, and always sets `Cache-Control: no-store`.

- [ ] **Step 3: Make integration cleanup unconditional**

Replace the temporary integration script with a stdlib wrapper `scripts/test-foundation.mjs` that runs Compose, tests, and always executes:

```sh
docker compose -p tomecms-foundation-test -f compose.test.yaml down --volumes --remove-orphans
```

The wrapper must target only the explicit `tomecms-foundation-test` project.

- [ ] **Step 4: Run and commit**

```sh
npm run test:unit
npm run test:integration:foundation
npm run check
npm run build
git add src/server/health.ts src/pages/health tests/integration/foundation.test.ts scripts/test-foundation.mjs package.json
git diff --cached --check
git diff --cached --stat
git commit -m "feat(core): expose bounded readiness checks"
```

## Task 6: Document the foundation without advertising an unfinished release

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update the development architecture section**

Document Node 22+, Docker Desktop, Compose v2, required local ports, `.env.local` ownership, how to obtain an AIStor Free license and set `MINIO_LICENSE_FILE` to its absolute ignored path, `node scripts/bootstrap-core.mjs`, `npm run db:migrate`, health routes, and the fact that the application still uses Supabase until all five migration plans complete.

- [ ] **Step 2: Verify commands and prose**

```sh
rg -n 'Node.js 22|Docker Desktop|PostgreSQL|AIStor|MINIO_LICENSE_FILE|Supabase|health/ready' README.md
npm run test:unit
npm run check
git diff --check
```

- [ ] **Step 3: Commit the foundation documentation**

```sh
git add README.md
git diff --cached --check
git diff --cached --stat
git commit -m "docs(core): explain replacement foundation"
```

## Foundation Completion Gate

- [ ] `npm run test:unit`, `npm run test:integration:foundation`, `npm run check`, and `npm run build` pass.
- [ ] A clean disposable Compose project migrates twice without error.
- [ ] `/health/live` and `/health/ready` expose no topology or secrets.
- [ ] The existing Supabase-backed CMS behavior is unchanged.
- [ ] No unpinned production image uses `latest`.
- [ ] `git status --short` contains no unplanned file.
