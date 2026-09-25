---
title: Tests
description: Every test command in the repository, what each one needs before it runs, and the throwaway stacks the slower ones start.
sidebar:
  order: 3
---

Every command here runs from the project directory, after the locked packages are installed:

```sh
npm ci
```

[Setting up for development](/tome-cms/contributing/setup/) covers Node.js and Docker. None of these commands uses the PostgreSQL, SeaweedFS or Astro that `npm run dev:macos` started, so they leave your development data alone.

## The commands

| Command | What it runs | What it needs |
| --- | --- | --- |
| `npm run check` | `astro check`, the self-tests of the backup, restore, reset, font and stylesheet scripts, a syntax check of the two shell helpers, and the design-token check | Node.js and bash |
| `npm run test:unit` | Every file under `tests/unit/` | Node.js and bash |
| `npm run build` | The production build | Node.js |
| `npm run test:operations` | `tests/operations/fresh-install.test.ts`: the backup, reset and restore scripts refuse to run without a narrow, explicit target | Node.js |
| `npm run test:integration:foundation` | The readiness check, or the integration files you name | Docker, and ports `55432` and `59000` free |
| `npm run test:integration` | Every file under `tests/integration/`, one at a time | Docker, and ports `55432` and `59000` free |
| `npm run test:e2e` | The browser specs under `tests/e2e/`, on both Playwright projects | Docker, ports `55432` and `59000` free, and Playwright's Chromium |
| `npm run test:operations:update` | The managed-update harness | Docker Engine with Compose, the pinned images, and a Go compiler |

The first four need no Docker. The pull request template asks for `npm run check` and `npm run test:unit`, and for the integration files and browser specs your change touches. On every pull request, CI runs `check`, `test:unit`, `build`, the whole integration suite and every browser spec.

## Unit tests

`npm run test:unit` runs Node's own test runner over `tests/unit/`. A unit test that drives a script which calls `docker`, `git` or `systemctl` runs it with a `PATH` that holds only stand-ins for those commands. The stand-ins write down what they were asked to do, and nothing on your computer is changed.

`tests/unit/managed-installer.test.ts` runs the install scripts through `/bin/bash`, and gives each run 20 seconds. On a busy computer it can fail for that reason alone. Run the file by itself before you treat a failure there as real:

```sh
node --import tsx --test tests/unit/managed-installer.test.ts
```

For the same reason, do not run the unit suite while a browser run is starting or tearing down its containers.

## Integration tests

`scripts/test-foundation.mjs` runs the integration tests. It starts PostgreSQL 17 and SeaweedFS 4.46 from `compose.test.yaml`, under the Compose project `tomecms-foundation-test`, on `127.0.0.1:55432` and `127.0.0.1:59000`. Their data is kept in memory. When the run ends, even after a failure or `Ctrl+C`, the runner removes the containers and their volumes.

```sh
npm run test:integration:foundation
node scripts/test-foundation.mjs tests/integration/<file>.test.ts
npm run test:integration
```

- With no file, it runs the readiness check, `tests/integration/foundation.test.ts`, with both services.
- With one or more files, it runs those. It starts SeaweedFS only when one of the files talks to storage, so a file that only needs the database gets PostgreSQL alone. `npm run test:integration:foundation -- tests/integration/<file>.test.ts` does the same.
- `npm run test:integration` passes `--all`: every file, one at a time, with both services. `--all` cannot be combined with file names.

Before each file, the runner empties the database, and every file migrates it from nothing.

## Browser tests

Each spec under `tests/e2e/` that needs a database starts its own PostgreSQL and SeaweedFS from `compose.test.yaml`, under a Compose project named for it, such as `tomecms-signin-test` or `tomecms-stats`. It then runs Astro's development server on a free port, and removes the stack when it is done. `passkey-installer.spec.ts` needs no database and starts only the server.

Both Playwright projects are Chromium: `desktop`, as Desktop Chrome, and `mobile`, as a Pixel 5. The specs that sign in use a virtual passkey, driven over the Chrome DevTools Protocol, which only Chromium speaks. Install that browser once:

```sh
npx playwright install chromium
```

On Linux, `npx playwright install --with-deps chromium` also installs the system libraries it needs, as CI does. To run one spec, on both projects:

```sh
npm run test:e2e -- tests/e2e/<file>.spec.ts
```

Playwright runs the specs one at a time, because they share the site's settings row.

## Ports 55432 and 59000

The integration runner, every browser spec and the documentation's screenshot script, `npm run docs:screenshots`, all publish PostgreSQL on `55432` and SeaweedFS on `59000`. Only one of them can run at a time. Wait until one has finished and removed its containers before you start the next.

## The managed-update harness

`npm run test:operations:update` runs `tests/operations/managed-update.test.ts`. It checks the updater that comes with 1.0.0 against real containers. It needs:

- Docker Engine with Compose, on an amd64 or arm64 machine
- the `postgres:17-alpine` and `chrislusf/seaweedfs:4.46` images, or permission to pull them
- a Go compiler

The harness compiles a small Go server that stands in for the TomeCMS application and builds it into two local images, marked `1.0.0` and `1.0.1`. It starts the first with PostgreSQL and SeaweedFS, their network and their volumes, under one Compose project with a random `tomecms-test-*` name. The real updater service from `src/updater/` then updates the stack to `1.0.1` through its Unix socket: it stops the application, backs up, runs the migration, checks readiness, switches the image, and rolls back to `1.0.0` when the new one fails its readiness check.

Three things are stand-ins: the downloads and attestation checks against GitHub, the mapping from the official image digest to the local image, and the probe of the target's migrations.

The harness registers its cleanup before it builds anything. The cleanup removes only what carries this run's label, and the test fails if a matching container, network, volume, image or temporary directory is left. The harness refuses the production project name, `tomecms`, and the production paths.

Passing it is a check on your own computer. Before 1.0.0 ships, the release still has to pass on disposable Ubuntu servers, on `linux/amd64` and `linux/arm64`, with the real GitHub and GHCR checks, systemd, the HTTPS wizard, passkeys, and content and media.

## The documentation site

This site lives in `website/`, with its own packages. The API reference is generated from `src/server/http/openapi.ts` and is not committed, so generate it before the first check:

```sh
npm ci --prefix website
npm run docs:openapi
npm --prefix website run check
npm --prefix website run build
npm run docs:check-search
```

`check` runs `astro check`, then fails when a page has no twin in the other language, or carries an em dash, an en dash or a word the style rules ban. `build` also checks every link between pages. `docs:check-search` starts a preview of the built site on port `4331`, searches it for a Thai word and an English one in Playwright's Chromium, and stops the preview. It refuses to start when something already answers on that port.
