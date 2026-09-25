---
title: Updating
description: Upgrade a 0.x install in place with the deploy helper, and see how many database migrations wait from each earlier version.
sidebar:
  order: 3
---

TomeCMS is still a pre-1.0 preview. You upgrade a 0.x install in place, from a newer checkout of the code, with the same deploy helper that installed it.

The admin cannot install an update yet. Under "System" it shows your version next to "Installed version:" and can check the official repository on GitHub for a newer stable release. On today's install that screen says "Managed updates unavailable", and "Update mode:" reads `check-only`.

## Upgrading a 0.x install

1. Stop the application, then back up PostgreSQL and the media bucket together and check the backup, as [Backups and restore](/tome-cms/running/backups/) describes. Leave the application stopped, so nothing is written that the backup does not hold.
2. Read the release notes of every version after yours. They are in `docs/releases/` in the repository, one file per version, and each says what its upgrade needs.
3. In the checkout, get the newer code and run the helper:

   ```sh
   git pull
   ./scripts/deploy-vps.sh
   ```

4. Check that the application is ready, as after [the first install](/tome-cms/start/install/):

   ```sh
   curl -s http://127.0.0.1:4321/health/ready
   ```

The helper keeps `.env.local` as it is. It builds the new application image, runs the waiting migrations in a one-shot container, and then starts the new application container. The site is down from the moment you stop the application until the new container is ready.

An install from 0.2.0 lacks settings the newer helper writes, so it stops with `Existing .env.local needs updates; rerun with --force to merge values while preserving secrets.` Run `./scripts/deploy-vps.sh --force` then: it adds the missing settings and keeps your secrets.

## Database migrations

A new version can change the database's tables. Each change is a migration, and this command applies every one the database does not have yet:

```sh
npm run db:migrate
```

The deploy helper runs it for you, inside a one-shot application container, so on today's install you do not need to. If you run it by hand in the checkout, run `npm ci` there once first. It reads the connection from `.env.local`.

It prints one `<name>: Success` line for each migration it applies, or `Up to date` when none was waiting. The waiting migrations run together in one PostgreSQL transaction. If one fails, the command prints `Migration failed`, none of them is applied, and the database stays as it was.

TomeCMS has no command that undoes a migration. To go back to an older version, restore the backup you made before the upgrade.

## How many are waiting

Find the version your install was created from, or last upgraded to, and count from there:

| Your install is from | Waiting | Which |
| --- | --- | --- |
| 0.11.0 | 0 | None |
| 0.10.0 | 2 | `024_site_maintenance` and `025_content_stats` |
| 0.9.0 or 0.8.0 | 3 | The two above and `023_home_slides` |
| 0.7.0 or 0.6.0 | 5 | The three above, `021_media_documents` and `022_navigation_new_tab` |
| 0.5.0 or 0.4.0 | 6 | The five above and `020_site_brand` |
| 0.3.0 | 9 | The six above, `017_scheduled_publishing`, `018_thai_slugs` and `019_content_redirects` |
| 0.2.0 | 18 | The nine above, and `008_update_rate_limit_actions` through `016_theme_settings` |

The counts follow each version's release notes. An install made from a checkout between two releases, or from before 0.2.0, can have a different number waiting. The admin's notice names them exactly.

## The admin's notice

When the code expects a migration the database does not have, every admin screen opens with the notice "The database is behind this build". After it, "Waiting:" is followed by the names of the migrations, and the notice warns that saving content fails until `npm run db:migrate` has run. The admin asks the database on each screen, so once the migrations have run, the notice is gone from the next screen you open.

Until then `/health/ready` reports `"migrations":"pending"` and `"status":"not-ready"`.

## What changes at 1.0.0

:::caution[Not released yet]
The managed updater comes with the managed install at 1.0.0, which is not released yet. None of this works on today's install.
:::

- A managed install runs a separate systemd service, `tomecms-updater`. With it, the owner can install a verified update from "System" in the admin, starting with 1.0.0 to 1.0.1.
- Before each update the updater takes a full backup of PostgreSQL and the bucket into `/var/backups/tome-cms/`, then runs the migrations. It never deletes old ones, so leave room for them on the disk and copy them off the server yourself.
- If an update fails after its migrations have started, the updater goes back to the previous application only when the new release declares the previous version compatible with the new database. Otherwise the update stops and waits for the server's operator. Restoring the database and the files from the backup is always done by hand.
- There are no automatic updates and no beta channel. The updater service itself, and the PostgreSQL and SeaweedFS images, are upgraded by hand.

A 0.x install cannot become a managed one in place. The move to 1.0.0 needs a fresh server, as [Installing on a VPS](/tome-cms/start/install/) explains.
