# TomeCMS Managed Web Updates Design

Date: 2026-09-13
Status: Approved for implementation planning
Target: Public `1.0.0` foundation, with the first web-managed upgrade from `1.0.0` to `1.0.1`

## Context

TomeCMS is a single-owner Astro application deployed with Docker Compose. It already has explicit PostgreSQL migrations, a complete PostgreSQL plus S3 backup command, Passkey authentication, and a readiness endpoint. The current production helper builds the application image from the local checkout. That is suitable before `1.0.0`, but it cannot safely support an owner clicking “Install update” in the Admin UI.

A web application must not receive direct access to Docker. Mounting `/var/run/docker.sock` into the Astro container would let a compromised web process control the host. Managed updates therefore require a small host-side updater with a narrow protocol. The app may request one exact TomeCMS version; only the updater may validate releases, run Docker Compose, take backups, apply migrations, restart the app, and roll back the image.

The repository is expected to become public at `1.0.0`. Public GitHub Releases provide stable-channel metadata, and public GitHub Container Registry images can be pulled without installing customer credentials. No TomeCMS-operated update or telemetry service is required for the first release.

## Product Decisions

- The default channel is `stable`; beta channels and unattended updates are deferred.
- Updates are manual and owner-initiated from `System → Updates`.
- Only a fresh managed VPS installation created by the `1.0.0` installer may install updates from the web.
- Local macOS, Windows, source checkouts, and unmanaged Docker installations may check for releases but never expose the Install action.
- Existing pre-`1.0.0` installations require one documented manual transition to the managed `1.0.0` deployment.
- GitHub Releases is the only stable release index in `1.x`.
- GHCR is the only application-image registry in `1.x`.
- The official repository and image names are compiled into TomeCMS and the updater; neither can be changed by a browser request.
- Every installed image is selected by immutable SHA-256 digest. Mutable tags are display and discovery aids only.
- The release pipeline produces multi-architecture images for `linux/amd64` and `linux/arm64`.
- The updater verifies the release asset digest, GitHub artifact attestations, image digest, version compatibility, and platform before changing the running application.
- PostgreSQL and SeaweedFS do not update as part of a routine TomeCMS application update. Infrastructure upgrades require an explicitly tested installer/updater release.
- Database migrations remain forward-only. Automatic database downgrade and automatic backup restore are out of scope.
- Every `1.x` database migration uses expand/contract compatibility and keeps the previous supported application version operational against the upgraded schema.
- The public Headless Content API remains `/api/v1` throughout `1.x`. Breaking API changes require `/api/v2`.
- The host updater does not update itself through the web. A release that needs a newer updater is blocked with a documented manual updater upgrade.
- Update checks send no installation ID, site URL, content data, or telemetry.

## Goals

- Show the installed and latest stable TomeCMS versions in Admin.
- Allow one recently reauthenticated owner to start one managed update.
- Keep Docker authority outside the web container.
- Verify that the requested release was built by the official repository workflow.
- Take a complete, checksum-manifested PostgreSQL and object-storage backup before migrations.
- Preserve a visible, restart-tolerant progress state while the app container is replaced.
- Restore the previous application image automatically when compatibility permits.
- Fail closed before data mutation when compatibility, provenance, capacity, or prerequisites are not satisfied.
- Keep local/source development unchanged and keep the bundled Blog and Headless modes equally updateable.

## Non-goals

- Unattended, scheduled, or forced security updates.
- Delta images or binary patching.
- Updating Docker Engine, PostgreSQL, SeaweedFS, a reverse proxy, DNS, or TLS.
- Supporting Kubernetes, Docker Swarm, shared hosting, or multiple application replicas.
- A central TomeCMS update service, licensing server, or telemetry collector.
- Installing arbitrary container images, Compose files, scripts, plugins, or URLs supplied by the browser.
- Automatically changing the updater, its systemd unit, the Compose contract, or the environment contract.
- Automatic database rollback or destructive down migrations.
- A no-downtime deployment. The `1.x` managed updater has a short maintenance window on a single VPS.

## Support Matrix

| Installation | Check latest release | Install from Admin | Supported update path |
| --- | --- | --- | --- |
| Managed VPS installed by TomeCMS `1.0.0+` | Yes | Yes | Exact official image digest through host updater |
| Local macOS or Windows development | Yes | No | Git checkout and normal development commands |
| Unmanaged/source-built Docker Compose | Yes | No | Operator-managed Git/build/deploy |
| Pre-`1.0.0` TomeCMS | Yes after checker lands | No | One manual transition to managed `1.0.0` |
| Headless mode on a managed VPS | Yes | Yes | Same app image and updater as bundled mode |

The Install button is a capability, not a configuration promise. The Admin API reports `check-only` unless it can connect to a compatible updater socket and confirm a managed installation.

## Architecture

```text
                         public, read-only HTTPS
  +----------------+     latest release + asset      +--------------------+
  | TomeCMS Admin  +-------------------------------->| GitHub Releases    |
  | Astro + React  |                                 +----------+---------+
  +--------+-------+                                            |
           | owner session                                      | manifest
           | same-origin Admin API                              v
  +--------v-------+      HTTP over Unix socket       +----------+---------+
  | Update bridge  +--------------------------------->| tomecms-updater    |
  | no Docker API  | target version only              | host systemd unit  |
  +----------------+                                  +----+----------+----+
                                                          |          |
                                       fixed argv commands|          | state
                                                          v          v
                                                  +-------+---+  +---+----------------+
                                                  | Docker    |  | /var/lib/tome-cms |
                                                  | Compose   |  | update history     |
                                                  +----+------+  +--------------------+
                                                       |
                                  exact GHCR digest     | app-only replacement
                                                       v
                                      +----------------+----------------+
                                      | App + PostgreSQL + SeaweedFS/S3 |
                                      +---------------------------------+
```

### Components

| Component | Responsibility | Explicitly cannot do |
| --- | --- | --- |
| Release workflow | Test, build, publish, attest, and create the immutable release manifest | Contact installed sites |
| In-app release checker | Fetch and cache public stable release metadata | Run Docker or mutate host state |
| Admin update bridge | Authenticate, authorize, rate-limit, and forward one version request | Choose a repository, image, command, or path |
| `tomecms-updater` | Validate the release and execute the fixed update transaction | Serve public traffic or read CMS sessions/content |
| Managed Compose bundle | Run the pinned app digest and pinned infrastructure | Pull infrastructure during routine app updates |
| Updater state store | Preserve sanitized progress and installed-image identity across app restarts | Store credentials, request headers, or raw child output |

## Trust Boundaries

### Browser to Astro

- All Admin update routes require the installed owner.
- Mutating requests require same-origin validation and database-backed rate limiting.
- Applying an update requires a Passkey-created session no older than five minutes.
- The request schema is exactly `{ "action": "apply", "version": "X.Y.Z" }`.
- The browser cannot submit a URL, image, digest, Compose service, command, argument, path, channel, or rollback policy.

### Astro to Updater

- Communication uses HTTP/1.1 over `/run/tome-cms/updater.sock`.
- The containing directory is mounted only into the app container.
- The socket is owned by the updater service and a dedicated group with mode `0660`.
- The app sends only a stable version and a request ID.
- The updater independently fetches and verifies the official release. It does not trust release data forwarded by Astro.
- Responses use strict, bounded JSON and contain enumerated public messages rather than child-process output.

### Updater to Host

- The updater runs as a dedicated system user with Docker-group access. Docker access is treated as host-root-equivalent authority.
- Every child process uses `spawn()` with a fixed executable and fixed argument array. Shell interpolation is forbidden.
- The service uses an allowlisted Compose file, project name, service names, environment files, backup root, repository, and image.
- The updater starts at most one transaction and persists its lock/state atomically.
- Child stdout/stderr is capped, sanitized, written to the system journal, and never returned to the browser.

## Release Discovery

The checker calls the public GitHub endpoint:

```text
GET https://api.github.com/repos/Dhanabhon/tome-cms/releases/latest
```

Rules:

- Use `Accept: application/vnd.github+json` and the current pinned GitHub API version header.
- Use a five-second timeout.
- Cache a successful stable result in the server process for six hours.
- Retain and send the response `ETag` on a manual refresh.
- Rate-limit manual refresh to six requests per ten minutes per client address.
- Accept only a published, non-draft, non-prerelease release whose tag is exactly `vX.Y.Z`.
- Require exactly one release asset named `update-manifest.json`.
- A network error, rate limit, malformed response, missing asset, or incompatible manifest is non-fatal to CMS operation. Admin shows the cached result when available and a safe “Update check unavailable” state otherwise.
- Do not use a GitHub token on installed sites. The public unauthenticated rate limit is sufficient for one owner plus six-hour caching.

## Release Manifest Contract

`update-manifest.json` is strict JSON. Unknown keys are rejected so a newer contract cannot be misinterpreted by an older updater.

```json
{
  "format": "tomecms-update",
  "manifestVersion": 1,
  "product": "tomecms",
  "channel": "stable",
  "version": "1.0.1",
  "releasedAt": "2026-09-20T10:00:00.000Z",
  "source": {
    "repository": "Dhanabhon/tome-cms",
    "commit": "0123456789abcdef0123456789abcdef01234567"
  },
  "image": {
    "repository": "ghcr.io/dhanabhon/tome-cms",
    "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "platforms": ["linux/amd64", "linux/arm64"]
  },
  "compatibility": {
    "minimumDirectUpgradeFrom": "1.0.0",
    "minimumUpdaterVersion": "1.0.0",
    "targetMigration": "007_preview_tokens",
    "rollbackSafeFrom": "1.0.0",
    "composeContract": 1,
    "environmentContract": 1,
    "updaterProtocol": 1
  },
  "releaseNotesUrl": "https://github.com/Dhanabhon/tome-cms/releases/tag/v1.0.1"
}
```

Validation requirements:

- Versions are stable SemVer core versions only: three non-negative decimal integers with no leading zeroes except `0`.
- The release tag, manifest version, and requested version must match exactly.
- Repository, image repository, channel, format, release-notes origin, and release-notes path prefix must match compiled official constants.
- A commit is exactly 40 lowercase hexadecimal characters.
- A digest is `sha256:` followed by 64 lowercase hexadecimal characters.
- Platforms are a non-empty, duplicate-free subset of `linux/amd64` and `linux/arm64`.
- Contract numbers are positive integers.
- `targetMigration` exactly matches a shipped migration key.
- The downloaded manifest bytes must match the SHA-256 digest reported by the GitHub release asset.
- The release API must report the release as immutable before the updater accepts it.
- `gh attestation verify` must validate both the manifest file and the OCI image against `Dhanabhon/tome-cms`.

The manifest contains no executable command, migration filename, download mirror, arbitrary URL, Compose fragment, or environment value.

## Version and Compatibility Policy

### Stable version comparison

Only stable `major.minor.patch` versions participate in the `1.x` updater. Numeric tuples are compared component by component. Pre-release/build suffixes are rejected rather than partially ordered.

### Direct upgrade gate

An update is installable only when all of the following are true:

- Target version is greater than installed version.
- Installed version is greater than or equal to `minimumDirectUpgradeFrom`.
- Installed updater version is greater than or equal to `minimumUpdaterVersion`.
- Compose, environment, and updater-protocol contracts equal the installed contracts.
- The release lists the host platform.
- The target migration exists in the target image.

When a contract differs, Admin shows “Manual updater upgrade required” and links to the official release notes. It never attempts to replace its own host helper.

### Database compatibility

For every automatic `1.x` update:

- Add a new column/table/index before any old application stops using the old shape.
- New columns read by the previous app must be nullable or have a compatible default.
- Do not drop, rename, narrow, or reinterpret a column in the same release that stops using it.
- Do not delete enum/check values that the previous app may write.
- Keep the previous supported image functional after target migrations.
- Perform destructive cleanup only in a later release after its `minimumDirectUpgradeFrom` excludes every image that needs the old shape.

`rollbackSafeFrom` is the oldest app version allowed to restart after the target migration. If the previous installed version is older than this value, the updater blocks before backup/migration rather than offering unsafe automatic rollback.

## Managed VPS Filesystem Contract

| Path | Owner/mode | Purpose |
| --- | --- | --- |
| `/opt/tome-cms/compose.managed.yaml` | `root:root`, `0644` | Stable managed Compose contract |
| `/opt/tome-cms/updater/` | `root:root`, non-writable by service | Compiled updater JavaScript |
| `/etc/tome-cms/tome-cms.env` | `root:tomecms-updater`, `0640` | Application and infrastructure secrets |
| `/etc/tome-cms/updater.json` | `root:root`, `0644` | Validated fixed paths and thresholds; no secrets |
| `/var/lib/tome-cms/updater/installed.json` | `tomecms-updater`, `0600` | Installed version, image digest, and contract versions |
| `/var/lib/tome-cms/updater/job.json` | `tomecms-updater`, `0600` | Durable last/current job state |
| `/var/lib/tome-cms/updater/image.env` | `tomecms-updater`, `0600` | Only `TOME_CMS_APP_IMAGE=...@sha256:...` |
| `/var/backups/tome-cms/` | `tomecms-updater`, `0700` | Complete update recovery points |
| `/run/tome-cms/updater.sock` | service/group, `0660` | Narrow app-to-updater protocol |
| `/run/tome-cms/status.json` | service/group, `0640` | Sanitized maintenance/progress mirror |

The source repository remains a development and manual-maintenance artifact; routine web updates do not run `git pull`, `npm install`, or a source build.

## Updater Configuration

`/etc/tome-cms/updater.json` uses one strict schema:

```json
{
  "configVersion": 1,
  "projectName": "tomecms",
  "composeFile": "/opt/tome-cms/compose.managed.yaml",
  "environmentFile": "/etc/tome-cms/tome-cms.env",
  "imageEnvironmentFile": "/var/lib/tome-cms/updater/image.env",
  "stateDirectory": "/var/lib/tome-cms/updater",
  "backupDirectory": "/var/backups/tome-cms",
  "socketPath": "/run/tome-cms/updater.sock",
  "statusPath": "/run/tome-cms/status.json",
  "appHealthUrl": "http://127.0.0.1:4321/health/ready",
  "minimumFreeBytes": 5368709120
}
```

The installer writes this file. Browser or CMS settings cannot alter it. Paths must be absolute, normalized, non-symlink targets under the exact prefixes above, and may not name a filesystem root.

## Socket Protocol

The first protocol version exposes two operations:

```text
GET  /v1/status
POST /v1/apply
```

`POST /v1/apply` accepts at most 4 KiB:

```json
{
  "version": "1.0.1",
  "requestId": "2cb65d31-2210-4cee-ab70-df64178948de"
}
```

It returns `202 Accepted` with the current job. A second apply request returns `409 Conflict` while any job is active. A request for the already installed version is idempotent and returns the existing installed state without running commands.

`GET /v1/status` returns no secret or raw log:

```json
{
  "protocolVersion": 1,
  "updaterVersion": "1.0.0",
  "managed": true,
  "installed": {
    "version": "1.0.0",
    "imageDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "job": {
    "id": "0e510266-2a57-43f1-bd02-7356d605d96d",
    "targetVersion": "1.0.1",
    "phase": "downloading",
    "completedSteps": 2,
    "totalSteps": 8,
    "message": "Downloading the verified update.",
    "startedAt": "2026-09-20T10:02:00.000Z",
    "finishedAt": null,
    "errorCode": null
  }
}
```

All fields and messages are generated by the updater. Unknown routes, methods, body keys, phases, or versions are rejected.

## State Machine

```text
idle
  -> preflight
  -> verifying
  -> downloading
  -> quiescing
  -> backing_up
  -> migrating
  -> restarting
  -> health_check
  -> succeeded

failure before migration  -> rolling_back -> rolled_back
failure after migration   -> rolling_back -> rolled_back
                         \-> failed_manual_recovery (only when rollback is unsafe or fails)
```

Terminal phases are `succeeded`, `rolled_back`, and `failed_manual_recovery`. Every transition atomically replaces both durable `job.json` and the sanitized runtime `status.json`. A service restart reconciles an interrupted non-terminal job:

- If the target digest is running and readiness passes, mark `succeeded` and finalize installed state.
- If the previous digest is running and readiness passes, mark `rolled_back`.
- Otherwise mark `failed_manual_recovery`, preserve the backup reference, and refuse another web update until an operator repairs the installation.

## Update Transaction

### Phase 1: Preflight

The updater performs read-only checks before downloading or stopping the app:

- Current installed state and image environment agree.
- Docker Engine, Compose, GitHub CLI, Compose file, environment file, state directory, backup directory, and health URL are available.
- The app, PostgreSQL, and configured object storage report healthy/ready.
- No non-terminal job or lock exists.
- Backup filesystem has at least 5 GiB free.
- Host architecture is supported by the target release.
- Installed/target version and all compatibility contracts permit a direct update and rollback.

### Phase 2: Verify and download

While the current app remains available:

1. Fetch the exact GitHub release by requested tag.
2. Require a published immutable stable release.
3. Download `update-manifest.json` to a private temporary directory.
4. Match its release-asset digest.
5. Verify the manifest attestation with GitHub CLI.
6. Parse the strict manifest and repeat every compatibility check.
7. Verify the OCI image attestation against the official repository.
8. Pull `ghcr.io/dhanabhon/tome-cms@sha256:…`.

No running service or persisted installed state changes in this phase.

### Phase 3: Quiesce and back up

1. Write the maintenance phase to runtime status so Admin content mutations return `503` with `Retry-After`.
2. Wait two seconds for the single-owner write path to drain.
3. Stop only the `app` service with a 30-second timeout.
4. Run the current application image as a one-shot backup container under the updater service’s numeric UID/GID; the running app never mounts the backup directory.
5. Dump PostgreSQL in custom format and mirror every TomeCMS S3 object.
6. Create the existing checksum manifest last and return its directory as structured JSON.
7. Parse the manifest and verify that it is complete before changing the application-image selection.

The backup is retained after success and failure. Automatic pruning is deferred until a retention policy is separately designed.

### Phase 4: Migrate and restart

1. Atomically write a candidate `image.env` containing the exact target digest.
2. Run `npm run db:migrate` once in the target image.
3. Start only the target `app` service with Compose `--wait` and a 90-second timeout.
4. Poll the loopback `/health/ready` endpoint with a bounded timeout.
5. Atomically commit `installed.json` only after readiness succeeds.
6. Mark the job `succeeded` and release the update lock.

### Phase 5: Rollback

If any operation fails after quiescing:

- Before migration starts, restore the previous image selection and start it.
- After migration starts, restore the previous image only when the target manifest allows rollback from that exact previous version.
- Never run a down migration.
- Mark `rolled_back` only after the previous image passes readiness.
- If rollback is disallowed or readiness fails, mark `failed_manual_recovery`, leave the backup untouched, and show the operator the documented recovery command.

The updater never automatically restores the database/object backup because that is more destructive than leaving a failed deployment for operator review.

## Managed Compose Contract

The managed Compose bundle differs from the source-development `compose.yaml`:

- `app.image` comes only from `TOME_CMS_APP_IMAGE` in `image.env` and must include an SHA-256 digest.
- `app` mounts `/run/tome-cms/` so Astro can reach the socket and read maintenance state.
- PostgreSQL and SeaweedFS images remain pinned and are not pulled during an application update.
- PostgreSQL and SeaweedFS volumes retain their existing names.
- The project name is always `tomecms`.
- The app continues to expose loopback port `4321` and `/health/ready`.
- The target image includes `pg_dump`, the direct backup path, and the migration CLI.
- Source/local Compose keeps its build-based workflow and never mounts the updater socket.

Changing these rules increments `composeContract` and requires a manual updater transition.

## Admin API

One same-origin route keeps the browser contract small:

```text
GET  /api/admin/system/updates
POST /api/admin/system/updates
```

`GET` returns:

- Current application version and update mode.
- Latest cached/check result.
- Compatibility/installability reason.
- Current updater job when managed.

`POST` accepts one of:

```json
{ "action": "check" }
```

```json
{ "action": "apply", "version": "1.0.1" }
```

`check` requires the owner, same origin, and the update-check rate limit. `apply` additionally requires a session created by a Passkey within the previous five minutes and a compatible updater status. It returns `202` and never waits for the update transaction to finish.

Admin uses `Cache-Control: no-store` and a request ID. Expected failures use safe `400`, `401`, `403`, `409`, `429`, or `503` responses. Unexpected child-process details remain in journald only.

## Admin UX

Add `System` to the Admin navigation and a `System updates` page with:

- Installed version.
- Latest stable version and publication date.
- “Up to date”, “Update available”, “Manual updater upgrade required”, “Check unavailable”, or “Managed updates unavailable” status.
- Release-notes link that opens GitHub in a new tab.
- `Check again` action.
- `Install X.Y.Z` only for a compatible managed VPS.
- A confirmation explaining that TomeCMS will create a backup and briefly restart.
- Passkey verification before the apply request.
- A visible eight-step progress list and progress bar.
- A “Reconnecting…” state while the app container is unavailable; poll with bounded exponential backoff from one to ten seconds.
- Success with the installed version and backup timestamp.
- Rollback or manual-recovery messages with one safe next action and no raw log.

The existing page remains loaded in the browser during the restart. Failed polling is expected and does not itself mark the update failed. After the app returns, polling reads durable updater state. Refreshing during downtime may show the reverse proxy’s normal unavailable response; a dedicated maintenance proxy is deferred.

## Content Write Quiescing

In managed mode, the updater mirrors its phase to `/run/tome-cms/status.json`. Before unsafe same-origin Admin API methods continue, middleware reads this bounded file. Phases from `quiescing` through `health_check` return `503` and `Retry-After: 10`.

The updater writes the marker before the two-second drain and refuses to stop the app if the marker cannot be written. This design is intentionally scoped to one owner and one app replica. A distributed write barrier is required before horizontal scaling or multi-user publishing.

## Release Pipeline

A stable tag `vX.Y.Z` starts the release workflow:

1. Require the tag version to equal `package.json`.
2. Run TypeScript checks, unit/integration checks selected as release gates, and the production build.
3. Build and push `linux/amd64` and `linux/arm64` to `ghcr.io/dhanabhon/tome-cms`.
4. Capture the registry digest.
5. Generate the strict manifest from reviewed constants and the build output.
6. Generate GitHub artifact attestations for the OCI image and manifest.
7. Create a published GitHub Release with `update-manifest.json` and generated notes.
8. Require the repository’s immutable-releases setting before enabling the managed updater.

The workflow receives only `contents: write`, `packages: write`, `id-token: write`, and `attestations: write` permissions. Installed sites receive no GitHub token.

## Timeouts and Limits

| Operation | Limit |
| --- | --- |
| GitHub metadata/manifest request | 5 seconds each |
| Socket request body | 4 KiB |
| Admin request body | Existing 1 MiB global parser limit; update schema remains tiny |
| Captured child output | 32 KiB per stream |
| Docker pull | 15 minutes |
| Backup | 60 minutes |
| Migration | 15 minutes |
| Compose stop | 30 seconds |
| Compose start/readiness | 90 seconds |
| Fresh Passkey session | 5 minutes |
| Manual check | 6 per 10 minutes per client |
| Apply attempts | 3 per 30 minutes per client |
| Release cache | 6 hours |
| Minimum free backup space | 5 GiB |

## Logging and Privacy

- Each job and Admin request has a UUID.
- The updater logs phase, version, duration, command name, exit classification, and safe error code.
- It does not log `.env` contents, request cookies, headers, database URLs, S3 credentials, installation tokens, raw manifest bodies, or child command lines containing secrets.
- Admin receives enumerated error codes such as `release_unavailable`, `incompatible_update`, `backup_failed`, `migration_failed`, `health_failed`, `rolled_back`, and `manual_recovery_required`.
- No outbound request contains a site identity beyond normal GitHub HTTP metadata such as source IP and User-Agent.

## Rollout

### `0.9.x`: Check-only foundation

- Add build identity, strict release manifest parsing, cached GitHub checking, and the Admin System page.
- Add the release workflow and publish candidate images/manifests.
- Keep every installation in `check-only` mode.

### `1.0.0`: Managed VPS foundation

- Publish the first immutable, attested stable image.
- Install the updater service, socket, managed Compose bundle, fixed filesystem layout, and backup path on fresh VPS installations.
- Enable manual Install only when the updater reports a compatible managed installation.
- Document the one-time manual transition for pre-`1.0.0` installations.

### `1.0.1`: First real web update

- Exercise the complete `1.0.0 → 1.0.1` backup, migration, restart, and rollback path on both supported architectures.
- Do not include a destructive database migration or infrastructure contract change.

Automatic security updates and beta channels require a new approved design after the manual flow has production evidence.

## Acceptance Criteria

- A local/source installation can check the latest release and cannot trigger host commands.
- A managed `1.0.0` VPS can install an attested `1.0.1` image by digest after owner confirmation and recent Passkey verification.
- A forged repository, URL, image, digest, manifest key, tag, platform, attestation, or incompatible contract is rejected before the app stops.
- A second update cannot start while one is active.
- A complete PostgreSQL plus S3 backup manifest exists before the image selection or database changes.
- The target migration runs exactly once and readiness gates success.
- A simulated target health failure returns to the previous image when compatibility permits.
- A simulated unsafe rollback reaches `failed_manual_recovery` without running a down migration or deleting the backup.
- Progress survives the app restart and is visible when the app reconnects.
- Routine application updates do not pull or replace PostgreSQL or SeaweedFS.
- Bundled and Headless modes keep their existing public behavior and `/api/v1` contract after update.
- No Docker socket is mounted into the app container, no permanent GitHub credential is installed, and no update telemetry is emitted.

## References

- [GitHub latest release endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- [GitHub Container Registry pull by digest](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#pull-by-digest)
- [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [GitHub REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Docker daemon security](https://docs.docker.com/engine/security/)
- [Docker Compose pull](https://docs.docker.com/reference/cli/docker/compose/pull/)
