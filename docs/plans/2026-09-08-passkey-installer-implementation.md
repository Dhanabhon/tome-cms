# Passkey Authentication and Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Better Auth database sessions, Passkey-first owner enrollment, recovery codes, local recovery, configurable Admin paths, and the six-step first-run Wizard on the new PostgreSQL foundation.

**Architecture:** Better Auth receives the shared `pg.Pool` and is mounted at one Astro catch-all route. Pre-auth Passkey registration accepts only a short-lived signed context backed by a single-use `installation_enrollments` row. The Wizard verifies infrastructure and the installation token before WebAuthn, then finalizes installation under a PostgreSQL advisory lock. Recovery codes are one-time HMAC hashes; local recovery creates a short-lived replacement-Passkey enrollment instead of a password.

**Tech Stack:** Better Auth, `@better-auth/passkey`, PostgreSQL, Kysely, Node crypto, Astro middleware, browser WebAuthn, Playwright Chromium virtual authenticator.

**Spec:** [`docs/specs/2026-09-08-headless-core-migration-design.md`](../specs/2026-09-08-headless-core-migration-design.md)

## Global Constraints

- Complete [`2026-09-08-headless-foundation-implementation.md`](./2026-09-08-headless-foundation-implementation.md) first.
- Run commands directly; do not use RTK.
- Pin Better Auth and the Passkey plugin to exact compatible versions in `package-lock.json`. Generate the vendor schema from that pinned configuration, review it, then encode it in TomeCMS's ordered TypeScript migration. Never run Better Auth DDL during a web request or production startup.
- `TOME_CMS_PUBLIC_URL` is the only source for WebAuthn RP ID and origin. Do not derive either from `Host`, `Forwarded`, or `X-Forwarded-*`.
- Allow loopback HTTP only outside production. Production Passkey registration/sign-in requires HTTPS.
- Passwords, magic links, OAuth, SMTP, stateless sessions, cross-subdomain cookies, PATs, and multi-user invitations are out of scope.
- Never log installation tokens, signed enrollment contexts, WebAuthn responses, recovery codes, session tokens, or signed recovery URLs.
- Keep the active Supabase Admin middleware in place until Plan 3 switches every content mutation to PostgreSQL. This plan may mount and test Better Auth and the new installer services, but it must not strand the existing Admin on incompatible sessions.
- Use one-owner semantics but retain a database `role = 'owner'` constraint. Do not build generic RBAC.
- All state-changing endpoints validate same-origin requests and apply database-backed rate limits.
- Before every commit, stage only named files, run `git diff --cached --check`, inspect the staged stat, and scan the staged patch for secret values.

## File Responsibility Map

| Area | Create | Modify |
| --- | --- | --- |
| Packages/client | `src/lib/auth-client.ts` | `package.json`, `package-lock.json` |
| Auth schema | `src/server/db/migrations/002_auth_installer.ts` | `src/server/db/types.ts`, `src/server/db/migrator.ts` |
| Auth server | `src/server/auth/config.ts`, `src/server/auth/session.ts`, `src/server/auth/origin.ts`, `src/env.d.ts` | none |
| Enrollment | `src/server/auth/context.ts`, `src/server/auth/enrollment.ts`, `src/server/auth/rate-limit.ts`, `tests/unit/auth-context.test.ts`, `tests/integration/auth-enrollment.test.ts` | none |
| Auth HTTP | `src/pages/api/auth/[...all].ts`, `src/pages/api/install/enroll.ts`, `src/pages/api/install/finalize.ts`, `src/pages/api/recovery/start.ts` | `src/pages/api/install/status.ts` |
| Wizard | `src/components/admin/InstallerWizard.tsx` | `src/pages/install.astro`, `src/styles/installer-tokens.css` |
| Admin auth/path | `src/components/admin/PasskeySignIn.tsx`, `src/server/content/site-settings.ts`, `tests/unit/admin-path.test.ts` | `src/middleware.ts`, `src/components/admin/AdminShell.astro`, `src/layouts/AdminLayout.astro`, all `src/pages/admin/**/*.astro` links |
| Recovery UI/CLI | `src/components/admin/SecurityManager.tsx`, `src/components/admin/RecoveryPasskey.tsx`, `src/pages/admin/security.astro`, `src/pages/recovery.astro`, `src/pages/api/admin/security/passkeys.ts`, `src/pages/api/admin/security/recovery-codes.ts`, `scripts/recover-owner.ts`, `tests/unit/recovery-codes.test.ts` | `package.json` |
| Browser tests | `tests/e2e/passkey-installer.spec.ts`, `tests/e2e/passkey-auth.spec.ts`, `tests/e2e/passkey-recovery.spec.ts` | `playwright.config.ts`, `tests/e2e/support.ts` |

---

## Task 1: Pin Better Auth and capture its database contract

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/server/auth/config.ts`
- Create: `src/server/db/migrations/002_auth_installer.ts`
- Modify: `src/server/db/types.ts`
- Modify: `src/server/db/migrator.ts`
- Create: `tests/integration/auth-enrollment.test.ts`

- [ ] **Step 1: Install the two required runtime packages**

```sh
npm install --save-exact better-auth@1.7.3 @better-auth/passkey@1.7.3
```

Do not add a second WebAuthn library: the Passkey plugin already uses the verified server/client ceremony implementation.

- [ ] **Step 2: Create the minimal config needed for schema generation**

Create the auth instance with the shared pool and fixed security options:

```ts
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';

import { pool } from '../db/client';
import { getServerEnv } from '../env';

const env = getServerEnv();
const publicUrl = new URL(env.TOME_CMS_PUBLIC_URL);

export const auth = betterAuth({
  baseURL: publicUrl.origin,
  database: pool,
  emailAndPassword: { enabled: false },
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [publicUrl.origin],
  user: { additionalFields: { role: { type: 'string', required: true, defaultValue: 'owner', input: false } } },
  plugins: [passkey({
    origin: publicUrl.origin,
    rpID: publicUrl.hostname,
    rpName: 'TomeCMS',
    registration: { requireSession: false, resolveUser: resolveEnrollmentUser },
  })],
});
```

Import `resolveEnrollmentUser` from Task 3; during this task it may throw `Enrollment is not available` so schema generation can run without permitting registration.

- [ ] **Step 3: Generate and review the pinned vendor schema**

Run the pinned CLI, not `@latest`:

```sh
npx --yes auth@1.7.3 generate --config src/server/auth/config.ts --output /tmp/tomecms-better-auth-schema.sql
sed -n '1,260p' /tmp/tomecms-better-auth-schema.sql
```

Encode the exact generated User, Session, Account, Verification, and Passkey tables, indexes, nullability, and foreign keys at the top of `002_auth_installer.ts` using Kysely schema-builder calls. Add TomeCMS-owned tables:

```ts
export interface InstallationEnrollmentTable {
  id: string;
  context_hash: string;
  purpose: 'install' | 'recovery';
  pending_user_id: string;
  email: string;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: Timestamp;
}

export interface RecoveryCodeTable {
  id: string;
  user_id: string;
  code_hash: string;
  created_at: Timestamp;
  consumed_at: Timestamp | null;
}

export interface SecurityRateLimitTable {
  key_hash: string;
  action: 'install' | 'signin' | 'recovery';
  window_started_at: Timestamp;
  attempts: number;
}

export interface SiteSettingsTable {
  id: boolean;
  owner_id: string;
  site_name: string;
  tagline: string;
  site_description: string;
  default_locale: 'th' | 'en';
  timezone: 'Asia/Bangkok' | 'UTC';
  admin_path: string;
  author_name: string;
  author_avatar_media_id: string | null;
  author_bio_th: string;
  author_bio_en: string;
  author_links: unknown;
  installed_at: Timestamp;
  updated_at: Timestamp;
}
```

Database constraints must enforce one `site_settings` row (`id = true`), one owner role, unique active context hashes, unique recovery hashes, valid locales/timezones, and `admin_path` matching `^/[a-z0-9][a-z0-9-]{1,39}$` while excluding `/api`, `/install`, `/health`, `/_astro`, `/blog`, `/th`, and `/en`.

- [ ] **Step 4: Write and run the migration integration test**

Test fresh migration, idempotent second migration, FK cascades, singleton settings, reserved Admin paths, and that vendor tables match the pinned Better Auth metadata. Run:

```sh
npm run test:integration:foundation -- tests/integration/auth-enrollment.test.ts
```

Expected before migration: FAIL on missing auth tables. Expected after implementation: PASS.

- [ ] **Step 5: Commit the auth database contract**

```sh
git add package.json package-lock.json src/server/auth/config.ts src/server/db/migrations/002_auth_installer.ts src/server/db/types.ts src/server/db/migrator.ts tests/integration/auth-enrollment.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(auth): add passkey database contract"
```

## Task 2: Mount Better Auth and expose typed server sessions

**Files:**

- Create: `src/pages/api/auth/[...all].ts`
- Create: `src/server/auth/session.ts`
- Create: `src/server/auth/origin.ts`
- Create: `src/lib/auth-client.ts`
- Create: `src/env.d.ts`
- Create: `tests/unit/auth-origin.test.ts`

- [ ] **Step 1: Write the failing origin-policy test**

Cover exact-origin acceptance, cross-origin rejection, missing Origin on safe GET/HEAD, localhost HTTP development acceptance, and production HTTP rejection. The validator receives the configured origin explicitly; it must not trust request host headers.

- [ ] **Step 2: Implement and test the boundary helpers**

Export:

```ts
export function assertSameOrigin(request: Request, configuredOrigin: string): void;
export async function getSession(headers: Headers): Promise<{ user: BetterAuthUser; session: BetterAuthSession } | null>;
export async function requireOwner(headers: Headers): Promise<{ user: BetterAuthUser; session: BetterAuthSession }>;
```

`requireOwner` throws a typed `HttpError(401)` for no session and `HttpError(403)` for a non-owner role. It must not accept an owner ID from a browser body.

Mount Better Auth exactly once:

```ts
import type { APIRoute } from 'astro';
import { auth } from '../../../server/auth/config';

export const ALL: APIRoute = ({ request }) => auth.handler(request);
```

Create the browser client:

```ts
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [passkeyClient()] });
```

Add typed nullable Better Auth `user` and `session` fields to `App.Locals`.

- [ ] **Step 3: Verify HTTP cookie behavior**

Start the app against disposable PostgreSQL and assert `/api/auth/get-session` returns no session anonymously, rejects untrusted Origin on mutations, and emits `HttpOnly`, `SameSite=Lax`, plus `Secure` in production configuration.

- [ ] **Step 4: Commit**

```sh
npm run test:unit -- tests/unit/auth-origin.test.ts
npm run check
git add src/pages/api/auth src/server/auth/session.ts src/server/auth/origin.ts src/lib/auth-client.ts src/env.d.ts tests/unit/auth-origin.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(auth): mount database-backed sessions"
```

## Task 3: Implement signed single-use enrollment contexts

**Files:**

- Create: `src/server/auth/context.ts`
- Create: `src/server/auth/enrollment.ts`
- Create: `src/server/auth/rate-limit.ts`
- Create: `tests/unit/auth-context.test.ts`
- Modify: `tests/integration/auth-enrollment.test.ts`
- Modify: `src/server/auth/config.ts`

- [ ] **Step 1: Write failing token and replay tests**

Test signature tampering, malformed base64url, wrong purpose, ten-minute expiry, context-row expiry, consumed context, installed-site rejection, concurrent consumption, rate-limit rollover, and that hashes—not raw tokens—are stored.

- [ ] **Step 2: Implement the compact signed context**

Use Node crypto only. The public context shape is:

```ts
interface EnrollmentClaims {
  v: 1;
  id: string;
  purpose: 'install' | 'recovery';
  exp: number;
}
```

Serialize as `base64url(JSON).base64url(HMAC-SHA256(payload))`. Verify with `timingSafeEqual`, validate the decoded claims with Zod, then look up `sha256(context)` in `installation_enrollments`. Signature validity alone never authorizes registration.

Export:

```ts
export async function createEnrollment(input: {
  email: string;
  purpose: 'install' | 'recovery';
  pendingUserId: string;
}): Promise<{ context: string; expiresAt: Date }>;

export async function resolveEnrollmentUser(input: {
  context?: string;
}): Promise<{ id: string; name: string; email: string }>;

export async function consumeEnrollment(context: string, trx: Transaction<Database>): Promise<string>;
```

`resolveEnrollmentUser` must accept Better Auth's actual callback argument shape, extract `context`, reject after `site_settings` exists for install purpose, and return only the matching pending user.

- [ ] **Step 3: Add the PostgreSQL rate limiter**

Use one atomic insert/upsert keyed by HMAC of `action + clientAddress`. Limits: installer 8/15 minutes, sign-in 10/15 minutes, recovery 5/30 minutes. Return retry seconds and map exceeded limits to `429` with `Retry-After`. Do not retain raw IP addresses.

Wrap relevant Better Auth POST paths in `src/pages/api/auth/[...all].ts` so Passkey sign-in and pre-auth registration consume the database-backed limit before `auth.handler(request)`. Do not rate-limit session reads.

- [ ] **Step 4: Run and commit**

```sh
npm run test:unit -- tests/unit/auth-context.test.ts
npm run test:integration:foundation -- tests/integration/auth-enrollment.test.ts
git add src/server/auth/context.ts src/server/auth/enrollment.ts src/server/auth/rate-limit.ts src/server/auth/config.ts tests/unit/auth-context.test.ts tests/integration/auth-enrollment.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(auth): secure passkey enrollment contexts"
```

## Task 4: Build the six-step first-run Wizard

**Files:**

- Create: `src/pages/api/install/enroll.ts`
- Create: `src/pages/api/install/finalize.ts`
- Create: `src/components/admin/InstallerWizard.tsx`
- Modify: `src/pages/api/install/status.ts`
- Modify: `src/pages/install.astro`
- Modify: `src/styles/installer-tokens.css`
- Create: `tests/e2e/passkey-installer.spec.ts`

- [ ] **Step 1: Write the failing Wizard contract**

In Chromium with a Playwright virtual authenticator, assert the visible sequence:

1. readiness with database, migrations, storage, and HTTPS/RP checks;
2. Site details, Tagline, locale, timezone, and validated Admin path;
3. owner email;
4. installation-token verification;
5. primary Passkey registration;
6. one-time recovery-code acknowledgement and completion.

Assert step and sub-step progress bars expose `aria-valuenow`, back is available only before registration starts, errors keep safe form values, concurrent finalization creates one owner, token/enrollment replay fails, and completion redirects to the configured Admin path.

- [ ] **Step 2: Implement strict request schemas**

Use a shared `installationInputSchema`:

```ts
export const installationInputSchema = z.object({
  siteName: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(120),
  siteDescription: z.string().trim().max(160),
  defaultLocale: z.enum(['th', 'en']),
  timezone: z.enum(['Asia/Bangkok', 'UTC']),
  adminPath: adminPathSchema,
  email: z.email().max(254),
}).strict();
```

`POST /api/install/enroll` validates same-origin, rate limit, constant-time installation-token match, readiness, and no installed row; it creates or safely replaces the pending user/enrollment and returns only `{ context, expiresAt, rp: { id, name } }`.

The browser invokes:

```ts
await authClient.passkey.addPasskey({
  context,
  name: 'Primary passkey',
  createSession: true,
});
```

It must inspect the returned `{ data, error }`; Better Auth Passkey client errors are not converted to thrown exceptions automatically. Better Auth 1.7.3 creates the database session/cookie as part of verified registration. Middleware keeps that pending session installer-scoped until `site_settings` commits, and abandoned-enrollment cleanup revokes it.

- [ ] **Step 3: Finalize atomically**

`POST /api/install/finalize` validates the context and site payload, then in one database transaction:

1. acquires `pg_advisory_xact_lock(hashtext('tomecms-install'))`;
2. rechecks absence of `site_settings`;
3. locks the enrollment row;
4. verifies one Passkey exists for the pending user;
5. inserts exactly one settings row;
6. generates 10 recovery codes, stores keyed hashes, and returns plaintext once;
7. consumes the enrollment.

If any step fails, no settings/recovery row commits. Do not mint a custom session cookie; retain the Better Auth session created by the verified Passkey response only after finalization succeeds, and revoke it when an enrollment expires or is abandoned.

- [ ] **Step 4: Implement the friendly progress UI**

Use the existing mint/evergreen design tokens and TomeCMS logo. The step progress bar reports `step / 6`; an activity bar reports readiness/migration/storage/Passkey/finalization work. Keep help adjacent to each failed check, provide Thai and English strings, preserve native keyboard/focus behavior, and keep recovery codes selectable with explicit download/copy and acknowledgement controls.

- [ ] **Step 5: Run and commit**

```sh
npm run test:e2e -- tests/e2e/passkey-installer.spec.ts --project=desktop
npm run check
npm run build
git add src/pages/api/install src/components/admin/InstallerWizard.tsx src/pages/install.astro src/styles/installer-tokens.css tests/e2e/passkey-installer.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(installer): enroll the owner with a passkey"
```

## Task 5: Protect and rewrite the configurable Admin path at cutover

**Files:**

- Create: `src/server/content/site-settings.ts`
- Create: `src/components/admin/PasskeySignIn.tsx`
- Create: `tests/unit/admin-path.test.ts`
- Modify: `src/middleware.ts`
- Modify: `src/components/admin/AdminShell.astro`
- Modify: `src/layouts/AdminLayout.astro`
- Modify: Admin-page internal links under `src/pages/admin/`
- Create: `tests/e2e/passkey-auth.spec.ts`

- [ ] **Step 1: Write failing path and sign-in tests**

Cover reserved paths, normalization, configured-path rewrite, nested Admin paths, direct `/admin` returning `404` when hidden, unauthenticated redirect to the configured login, successful Passkey sign-in, logout/session revocation, expired session, and no open redirect.

- [ ] **Step 2: Add the shared path helpers**

Export:

```ts
export function normalizeAdminPath(value: string): string;
export function adminHref(settings: Pick<SiteSettings, 'admin_path'>, suffix?: string): string;
export function matchAdminPath(pathname: string, adminPath: string): string | null;
```

Every Admin link uses `adminHref`; do not scatter string replacement. `matchAdminPath` returns the internal suffix only for the exact configured prefix boundary.

- [ ] **Step 3: Prepare the final middleware but gate activation on Plan 3**

Add composable middleware functions for install state, Better Auth locals, configurable path rewrite, and Admin protection. Keep the existing Supabase auth branch active until Plan 3 moves all Admin APIs and pages; mark the one switch point with a plan comment referencing Plan 3, not an environment toggle shipped to users.

At Plan 3 cutover, the middleware sequence must:

- leave `/api/auth`, `/api/install`, `/api/recovery`, `/health`, `/_astro`, and public assets at stable paths;
- rewrite `<adminPath>` to `/admin` with `next(internalPath)`;
- return `404` for direct `/admin` when configured differently;
- set Better Auth session/user in `locals` once per request;
- redirect unauthenticated Admin page requests to `<adminPath>?signin=1`;
- return `401` JSON for `/api/admin/*` through endpoint guards, not middleware HTML.

- [ ] **Step 4: Replace the password form with Passkey sign-in UI**

The UI calls `authClient.signIn.passkey()`, distinguishes unsupported WebAuthn from rejected credentials, announces errors in an `aria-live` region, and offers recovery without exposing whether an email exists.

- [ ] **Step 5: Run and commit**

```sh
npm run test:unit -- tests/unit/admin-path.test.ts
npm run test:e2e -- tests/e2e/passkey-auth.spec.ts --project=desktop
npm run check
git add src/server/content/site-settings.ts src/components/admin/PasskeySignIn.tsx src/middleware.ts src/components/admin/AdminShell.astro src/layouts/AdminLayout.astro src/pages/admin tests/unit/admin-path.test.ts tests/e2e/passkey-auth.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat(auth): prepare passkey admin access"
```

## Task 6: Add spare Passkeys, recovery codes, and local recovery

**Files:**

- Create: `src/components/admin/SecurityManager.tsx`
- Create: `src/components/admin/RecoveryPasskey.tsx`
- Create: `src/pages/admin/security.astro`
- Create: `src/pages/recovery.astro`
- Create: `src/pages/api/admin/security/passkeys.ts`
- Create: `src/pages/api/admin/security/recovery-codes.ts`
- Create: `src/pages/api/recovery/start.ts`
- Create: `src/server/auth/recovery.ts`
- Create: `scripts/recover-owner.ts`
- Create: `tests/unit/recovery-codes.test.ts`
- Create: `tests/e2e/passkey-recovery.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing recovery primitive tests**

Test code format, at least 128 bits of entropy per code, HMAC hashing with `TOME_CMS_RECOVERY_PEPPER`, constant-time verification, one-time consumption, set regeneration invalidating previous unused codes, and no plaintext storage.

- [ ] **Step 2: Implement minimum recovery primitives**

Export:

```ts
export function generateRecoveryCodes(count?: number): string[];
export function hashRecoveryCode(code: string): string;
export async function consumeRecoveryCode(code: string): Promise<{ context: string; expiresAt: Date }>;
export async function regenerateRecoveryCodes(ownerId: string): Promise<string[]>;
```

Consumption runs in a transaction, locks the matching unused hash, marks it consumed, revokes all user sessions, and creates a ten-minute `purpose = 'recovery'` enrollment. Generic HTTP responses must not reveal whether a code or account exists.

`/recovery` accepts either a recovery code or the CLI-issued enrollment context. After `/api/recovery/start` returns a valid context, `RecoveryPasskey` calls `authClient.passkey.addPasskey({ context, name: 'Recovery passkey', createSession: true })`, checks the returned `{ data, error }`, and redirects to the configured Admin path only after the replacement credential succeeds.

- [ ] **Step 3: Build the Security screen**

List Passkey name, creation time, and last-used time from Better Auth. Allow adding a spare Passkey, renaming it, deleting only when another remains, and regenerating recovery codes only after a fresh Passkey assertion. Show plaintext codes once.

- [ ] **Step 4: Implement direct-access CLI recovery**

Add:

```json
{ "admin:recover": "node --env-file-if-exists=.env.local --import tsx scripts/recover-owner.ts" }
```

The CLI must verify TTY, connect directly to PostgreSQL, display public URL/site/owner, require typing `RECOVER <origin>`, revoke sessions, create a one-time ten-minute enrollment, and print `<TOME_CMS_PUBLIC_URL>/recovery?context=...`. It must default to inspection and make no change without confirmation.

- [ ] **Step 5: Verify browser and CLI recovery**

Playwright covers spare credential, last-Passkey refusal, recovery-code replay, session revocation, and successful replacement credential. A CLI self-test covers option parsing and confirmation without a database.

- [ ] **Step 6: Commit**

```sh
npm run test:unit -- tests/unit/recovery-codes.test.ts
npm run test:e2e -- tests/e2e/passkey-recovery.spec.ts --project=desktop
npm run check
git add src/components/admin/SecurityManager.tsx src/components/admin/RecoveryPasskey.tsx src/pages/admin/security.astro src/pages/recovery.astro src/pages/api/admin/security src/pages/api/recovery src/server/auth/recovery.ts scripts/recover-owner.ts tests/unit/recovery-codes.test.ts tests/e2e/passkey-recovery.spec.ts package.json
git diff --cached --check
git diff --cached --stat
git commit -m "feat(auth): add passkey recovery paths"
```

## Task 7: Complete the Passkey test matrix

**Files:**

- Modify: `playwright.config.ts`
- Modify: `tests/e2e/support.ts`
- Modify: `README.md`

- [ ] **Step 1: Add explicit browser projects**

Keep Chromium desktop/mobile and add one WebKit project for unsupported-Passkey/recovery UX. Virtual authenticators run only in Chromium through CDP; do not pretend WebKit supports the same fixture.

- [ ] **Step 2: Add safe E2E helpers**

Create helpers to attach/remove a virtual authenticator, obtain an authenticated Better Auth session through UI or a server-only test hook enabled only when `NODE_ENV=test`, and clean Better Auth/installer rows by explicit disposable database URL. Never add a production backdoor.

- [ ] **Step 3: Document RP/origin and recovery**

README must state that changing `TOME_CMS_PUBLIC_URL` after registering Passkeys can lock out the owner, HTTPS is mandatory on VPS, localhost HTTP is development-only, and spare Passkeys/recovery codes should be prepared before device loss.

- [ ] **Step 4: Run the plan gate**

```sh
npm run test:unit
npm run test:integration:foundation
npm run test:e2e -- tests/e2e/passkey-installer.spec.ts tests/e2e/passkey-auth.spec.ts tests/e2e/passkey-recovery.spec.ts
npm run check
npm run build
```

- [ ] **Step 5: Commit**

```sh
git add playwright.config.ts tests/e2e/support.ts README.md
git diff --cached --check
git diff --cached --stat
git commit -m "test(auth): cover passkey enrollment and recovery"
```

## Passkey and Installer Completion Gate

- [ ] Better Auth vendor tables exactly match the pinned package configuration.
- [ ] Installation and recovery contexts expire, are query-purpose bound, and cannot be replayed.
- [ ] The Wizard completes with one owner, one Passkey, and one displayed-once recovery set.
- [ ] Concurrent finalization creates one installed site.
- [ ] Production configuration rejects HTTP origins and untrusted Origin headers.
- [ ] The final Passkey cannot be deleted.
- [ ] Existing Supabase Admin traffic remains functional until the explicit Plan 3 cutover point.
- [ ] No password, SMTP, OAuth, PAT, or generic RBAC code was added.
