---
title: Project layout
description: What TomeCMS is built with, and where each part of it lives in the repository.
sidebar:
  order: 2
---

TomeCMS is one Astro application. The public site, the admin, the admin's own API and the public content API all run in the same Node.js process, and [What TomeCMS is](/tome-cms/start/what-is-tomecms/) has a diagram of how they fit together.

## The stack

| Layer | What it uses |
| --- | --- |
| Application | Astro 7, rendering every request on the server, on Node.js 22 through `@astrojs/node` |
| Admin | React 18 islands, with Tiptap 3 for the editor |
| Styles | Tailwind CSS 3, on the design tokens in `src/styles/installer-tokens.css` |
| Database | PostgreSQL 17, through Kysely |
| Sign-in | Better Auth, with passkeys |
| Files | S3-compatible storage through the AWS SDK. Local development and a self-hosted server use SeaweedFS 4.46, and `sharp` resizes pictures. |
| Deployment | Docker Compose |
| Tests | Node's own test runner, and Playwright for the browser |

`src/styles/installer-tokens.css` owns every colour, spacing, radius and type token. `DESIGN.md` describes them, and `npm run check` fails when the two disagree.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/pages/` | Every route: the public site, the admin, the installer and the health checks |
| `src/pages/admin/` | The admin's screens |
| `src/pages/api/admin/` | The admin's own API, for a signed-in owner on the same origin |
| `src/pages/api/v1/` | The public API: published content, and the Stats counter |
| `src/middleware.ts` | Runs before every route, for the installer, the admin's sign-in, maintenance and headless mode |
| `src/layouts/` | The frame of a public page and of an admin screen |
| `src/components/admin/` | The admin's React islands, the editor among them |
| `src/components/blog/` | The `<head>` tags every theme shares |
| `src/themes/` | The public site's templates and CSS, one directory per theme |
| `src/plugins/` | The plugin contract, and the plugins that fill it |
| `src/lib/` | Helpers used across the app, and the two word lists |
| `src/styles/` | The design tokens and the shared stylesheets |
| `src/server/` | Code that runs only on the server |
| `src/update/`, `src/updater/` | The managed updater, a host service of its own |
| `scripts/` | Setup, deployment, migration, backup and recovery helpers |
| `tests/` | Unit, integration, operations and browser tests |
| `docs/specs/`, `docs/plans/` | Designs and implementation plans |
| `docs/releases/` | Release notes, one file per version |
| `website/` | This documentation site |

The words the admin shows are in `src/lib/admin-i18n.ts`, and the public site's in `src/lib/i18n.ts`. Both are written in English and in Thai.

## Inside src/server

| Directory | What it holds |
| --- | --- |
| `auth/` | Better Auth, passkeys, enrollment, recovery and the installation |
| `content/` | Posts, pages, categories, menus, home slides, settings, redirects and maintenance, in PostgreSQL |
| `db/` | The Kysely schema, the database client and the migrations |
| `http/` | The public API's responses and errors, and its OpenAPI document in `openapi.ts` |
| `media/` | The S3 storage boundary and the file library |
| `plugins/` | Plugin settings, the sealing of secret ones, and the core's side of each hook |
| `stats/` | Counting views and reads, and the reports |
| `themes/` | Each theme's stored settings |
| `update/` | The update check under "System", and the client that talks to the updater |

A change to the database is a new numbered file in `src/server/db/migrations/`. [How to contribute](/tome-cms/contributing/how-to-contribute/) says where else it is registered.

## Around the code

| File or directory | What it is |
| --- | --- |
| `compose.yaml` | PostgreSQL and SeaweedFS for development, and the application too under the `production` profile, for today's install |
| `compose.managed.yaml` | The managed install from 1.0.0, which runs the application from an official image |
| `compose.test.yaml` | The disposable PostgreSQL and SeaweedFS that the integration and browser tests start |
| `Dockerfile` | The application image |
| `config/` | SeaweedFS's S3 settings, and the updater's systemd unit |
| `playwright.config.ts` | The browser tests' two projects, desktop and phone |

The updater in `src/update/` and `src/updater/` is compiled on its own, with `npm run build:updater`, and runs beside the application on a managed server. [Updating](/tome-cms/running/updating/) says what it does, and that it comes with 1.0.0, which is not released yet.

[Tests](/tome-cms/contributing/tests/) says what each directory under `tests/` checks and what it needs to run.
