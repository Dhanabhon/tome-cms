# Tome CLI, part A: looking after the server

Date: 2026-10-02
Status: Design. The owner approved the commands and two decisions on 2026-10-02:
- it is an installed `tome` command;
- `tome update` may install an update after a y/N prompt.

It ships in 1.11.0 beside the Almanac theme. Parts B (theme and plugin tools) and C (content with
tokens) come later.

## Why

Looking after a managed install today means long commands, such as:
- `sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml --env-file … logs`;
- `sudo curl --unix-socket /run/tome-cms/updater.sock http://localhost/v1/status`.

On 2026-10-02 a full disk took reading the updater's raw status JSON, `df` and `docker system df`
to diagnose. `tome` puts those behind short commands that already know the paths.

## Commands

All of them:
- **run as root,** with `sudo`. Run as anyone else, they say so and exit 1;
- **have a fixed exit code:** 0 for success, 1 for a failure or refusal, 2 for wrong usage;
- **never print a secret.** Environment values, passwords and tokens are never shown; reuse the
  updater's redaction;
- **print in English,** plain and short. The docs explain them in both languages;
- **accept `--help`.**

### `tome status`

One screen, read-only:
- the app version and the updater version (from `/v1/status`);
- whether the site is ready: `GET http://127.0.0.1:4321/health/ready`, with its `status` and
  `migrations`;
- the containers app, postgres and seaweedfs: running or not, and their health
  (`docker compose ps`);
- free disk where backups go, with a warning line below the updater's minimum (5 GiB) that names
  `tome prune`;
- the last update job: version, phase, error code and when it finished, in the server's local
  time;
- the newest backup: its kind (database or full), size and age, from the updater's backup
  directory.

`--json` prints the same as one JSON object, for scripts.

### `tome logs [app|postgres|seaweedfs|updater]`

- With no service named, it shows `app`.
- The first three come from `docker compose logs`, the managed compose project and files.
- `updater` comes from `journalctl -u tomecms-updater`.
- `-n N` sets the line count (default 100). `-f` follows.

### `tome backup`

- It asks the updater for a backup (`POST /v1/backup`).
- **The prompt says the site is in maintenance while it runs,** with an estimate from the last
  backup's duration, then y/N. `--yes` skips the prompt.
- **What the updater does:** it takes the same steps as an update's backup:
  1. the maintenance marker;
  2. stopping the app;
  3. the offline backup in a one-shot container;
  4. starting the app;
  5. waiting for `/health/ready`.

  It always starts the app again, even when the backup fails.
- **The kind:** database-only by default, or `--full` for database and media, the way a migration
  update backs up.
- **While it runs,** the CLI shows the steps as they happen, polling the job. At the end it prints
  where the backup went and its size.
- **Refusals:** it is refused while an update or another backup is running, with the updater's
  existing lock giving 409 `update_in_progress`, and refused when the disk is below the minimum.

### `tome update [version]`

- With no version, it asks GitHub for the newest stable release, the same release check the admin
  uses, and shows the installed version, the newest version and its notes link. With a version, it
  uses that one.
- **When already up to date,** it says so and exits 0.
- **Otherwise it prompts** "Install 1.x.y? The updater checks the release, backs up the database
  (or everything, when the release has a migration) and puts the site in maintenance for a few
  minutes. [y/N]". `--yes` skips the prompt.
- **Then** it calls the existing `POST /v1/apply`, with a fresh request id, the same body the admin
  sends.
- **It follows the job until it ends,** step by step: "Verifying the release", "Backing up",
  "Migrating" and the rest, using the same step names as System. It prints success, or the error
  code and what to do. `insufficient_disk_space` names `tome prune`.
- **No passkey here, by the owner's decision.** Running `sudo` on the server already means full
  control of it. The updater's own checks are all unchanged: attestations, compatibility, the
  backup, and rollback on failure.

### `tome prune`

- It asks the updater for its image clean-up (`POST /v1/prune`), the same rules as after an
  update:
  - only the official application images (`ghcr.io/dhanabhon/tome-cms`);
  - only untagged ones;
  - keeping the installed digest and the previous one;
  - nothing removed if Docker's listing cannot be read in full.
- **By default it is a dry run.** It lists what would go, with sizes, and the total.
- **`tome prune --yes`** removes them and prints what went and the space freed.
- **Refusals:** it is refused while an update or backup is running.

## The updater (1.5.0)

Two new endpoints on the existing socket, under protocol 1. Both use the same `active` lock as
`/v1/apply`, so updates, backups and prunes never overlap:
- **`POST /v1/backup`** with `{ requestId, kind: 'database' | 'full' }`. It answers 202 with
  `{ id, phase }`.
  - **Its own state.** A backup keeps its own state file, `backup-job.json` in the updater's state
    directory: id, kind, phase (`quiescing`, `backing_up`, `restarting`, `succeeded`, `failed`),
    `startedAt`, `finishedAt`, `backupDirectory`, `sizeBytes`, `errorCode`.
  - **`GET /v1/backup`** returns that record, for the CLI to follow.
  - **`/v1/status` and the update `job` record are not changed.** The app's updater client parses
    them strictly (`.strict()`), in 1.9.x and 1.10.x too. A new field there, or a backup in `job`,
    would make an already-installed app treat the server as unmanaged. System in the admin
    therefore does not show backups; the CLI does.
  - **Same safety as an update.** The backup path writes the same public maintenance marker an
    update writes, and always clears it and starts the app again.
- **`POST /v1/prune`** with `{ dryRun: boolean }`. It answers 200 with `{ candidates: [{ id,
  size }], removed: [...] }`. It reuses `src/updater/prune.ts`, with dry-run support added. It
  needs the installed and previous digests from the state.

`UPDATER_VERSION` becomes `1.5.0`. The release manifest's `minimumUpdaterVersion` stays `1.0.0`:
the app does not need the new endpoints.

## Installing `tome`

- **The code** lives in `src/cli/` (`main.ts` and one file per command). It is built with the
  updater (`tsconfig.updater.json`, or a sibling config) into `/opt/tome-cms/updater/cli/`.
- **The command** is `/usr/local/bin/tome`, a two-line shim:
  `#!/bin/sh` and `exec /usr/bin/node /opt/tome-cms/updater/cli/main.js "$@"`.
  Mode 0755, owned by root.
- **Who installs it:**
  - `scripts/install-managed-vps.sh` installs it on new servers;
  - `scripts/updater-upgrade.ts` installs or replaces it on existing ones, so `sudo npm run
    updater:upgrade` brings both the updater and `tome`. Its dry run lists the shim too, and it
    keeps the previous CLI beside the previous updater.
- **Configuration.** It reads the paths from the updater's config (`/etc/tome-cms/updater.json`,
  via `parseUpdaterConfig`); nothing is hard-coded twice.

## Security

- **Root only.** It checks `process.getuid() === 0` first.
- **Commands are run as argv arrays,** never shell strings.
- **The socket is the only way it changes the server,** apart from reading logs. It never stops
  containers or deletes images itself.
- **Updates follow the existing path.** `tome update` does nothing the admin's update does not
  already do, apart from the passkey, which is meaningless on the server itself.

## Docs

- **A new page, `running/cli.md`, in en and th:** installing (through `updater:upgrade`), each
  command with an example of its output, and the exit codes.
- **Troubleshooting and updating, en and th:** where they show the long compose or curl commands,
  show the `tome` one first and keep the long one for servers without it.

## Tests

- **Unit:**
  - argument parsing and `--help` for every command;
  - the root check;
  - the status assembly from fixture answers;
  - the step display from a job's timeline;
  - the prompt and `--yes`;
  - redaction;
  - prune dry-run output;
  - exit codes.
- **The updater:**
  - unit tests for `/v1/backup` and `/v1/prune`: the lock against apply, a refusal while active,
    and the backup job record;
  - `/v1/status` and the job record unchanged byte for byte in shape, with a test that the app's
    strict client still parses a status taken during and after a backup.
- **The managed update harness** (`npm run test:operations:update`):
  - `tome status`, `tome backup` and `tome prune` (dry run and real) against the harness server;
  - `updater:upgrade` installing the shim.

## Release

- 1.11.0 needs no migration from this part.
- The notes say:
  1. update the app to 1.11.0 from System, as usual;
  2. run `sudo npm run updater:upgrade` from a 1.11.0 checkout, which brings updater 1.5.0 and
     `tome`.
