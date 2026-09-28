---
title: Updating
description: Install an update from the admin on a managed install, upgrade a build from source with the deploy helper, and see how many database migrations wait from each earlier version.
sidebar:
  order: 3
---

A managed install, from 1.0.0 on, installs an update from the admin. A build from source, and every 0.x install, is upgraded on the server with the deploy helper that installed it.

Under "System", the admin shows your version next to "Installed version:" and checks the official repository on GitHub for a newer stable release. On a build from source that screen says "Updating from the admin is off", and "Update mode:" reads "Notify only": it tells you about a new version but cannot install it.

![The System screen. "System updates" shows an "Update status" card with "Release availability: Up to date", "Installed version: 0.12.1", "Latest stable version: 0.12.1", "Published: Sep 26, 2026" and "TomeCMS is up to date.", a "Read release notes" link, and a "Check again" button. Below it, an "Updating from the admin is off" card says "This server can tell you about new versions but cannot install them. To update, follow the update guide on the server.", with "Update mode:" reading "Notify only".](../../../assets/screenshots/en/system.png)

## Updating a managed install

:::caution[Installed with 1.0.1 or 1.0.2]
Before the first update from the admin, run the application under an init, as root. Without it, the update stops at "Prepare maintenance" and the site goes down, as [Troubleshooting](/tome-cms/running/troubleshooting/#the-update-stops-at-prepare-maintenance-and-the-site-answers-502) describes. A web update replaces only the application image, so the Compose file keeps the version the server was installed with. A server installed with 1.0.3 or later has it already.

```sh
grep -q '^    init: true' /opt/tome-cms/compose.managed.yaml || sed -i '/^  app:$/a\    init: true' /opt/tome-cms/compose.managed.yaml
cd /opt/tome-cms && docker compose -p tomecms -f compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env up -d --wait --no-deps --pull never app
```
:::

On a managed install, "Update mode:" reads "From the admin". When a newer release is out, "System" says "TomeCMS 1.0.5 is available.", with that release's version.

1. Press "Read release notes" and read the notes of every version after yours.
2. Press "Install 1.0.5". The admin asks "Install TomeCMS 1.0.5?". Press "Install 1.0.5" again, then confirm with your passkey.
3. Keep the page open. "Installation progress" ticks off each step: "Check prerequisites", "Verify the official update", "Download update", "Prepare maintenance", "Create recovery backup", "Apply database migrations", "Restart TomeCMS" and "Check application health". The site is briefly down while TomeCMS restarts.
4. When it is done, "System" says "TomeCMS 1.0.5 is installed."

What the updater does, and does not do:

- It installs only an official release that it has verified against the release's attestations, the same checks the installer makes.
- Before each update it takes a full backup of PostgreSQL and the bucket into `/var/backups/tome-cms/`, then runs the migrations. It never deletes old backups, so leave room for them on the disk and copy them off the server yourself.
- If an update fails after its migrations have started, it goes back to the previous application only when the new release declares the previous version compatible with the new database. The admin then says "Your previous application is running." Otherwise the update stops and waits for the server's operator, as [Recovery](/tome-cms/running/recovery/#recovering-a-managed-installation) describes. Restoring the database and the files from the backup is always done by hand.
- There are no automatic updates and no beta channel. The updater service itself, and the PostgreSQL and SeaweedFS images, are upgraded by hand.

A 0.x install cannot become a managed one in place. The move to 1.0.0 needs a fresh server, as [Installing on a VPS](/tome-cms/start/install/#moving-from-0x) explains.

## Upgrading a build from source

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

The updater and the deploy helper both run it for you, inside a one-shot application container, so you do not need to. If you run it by hand in the checkout, run `npm ci` there once first. It reads the connection from `.env.local`.

It prints one `<name>: Success` line for each migration it applies, or `Up to date` when none was waiting. The waiting migrations run together in one PostgreSQL transaction. If one fails, the command prints `Migration failed`, none of them is applied, and the database stays as it was.

TomeCMS has no command that undoes a migration. To go back to an older version, restore the backup you made before the upgrade.

## How many are waiting

Find the version your install was created from, or last upgraded to, and count from there:

| Your install is from | Waiting | Which |
| --- | --- | --- |
| 1.0.4, 1.0.3, 1.0.2, 1.0.1, 1.0.0, 0.14.1, 0.14.0, 0.13.0 or 0.12.1 | 0 | None |
| 0.12.0 or 0.11.0 | 1 | `026_planned_dates` |
| 0.10.0 | 3 | The one above, `024_site_maintenance` and `025_content_stats` |
| 0.9.0 or 0.8.0 | 4 | The three above and `023_home_slides` |
| 0.7.0 or 0.6.0 | 6 | The four above, `021_media_documents` and `022_navigation_new_tab` |
| 0.5.0 or 0.4.0 | 7 | The six above and `020_site_brand` |
| 0.3.0 | 10 | The seven above, `017_scheduled_publishing`, `018_thai_slugs` and `019_content_redirects` |
| 0.2.0 | 19 | The ten above, and `008_update_rate_limit_actions` through `016_theme_settings` |

The counts follow each version's release notes. An install made from a checkout between two releases, or from before 0.2.0, can have a different number waiting. The admin's notice names them exactly.

## The admin's notice

When the code expects a migration the database does not have, every admin screen opens with the notice "The database needs updating". It first warns that saving will fail until someone runs `npm run db:migrate` on the server, then lists the migrations after "Waiting:". The admin asks the database on each screen, so once the migrations have run, the notice is gone from the next screen you open.

Until then `/health/ready` reports `"migrations":"pending"` and `"status":"not-ready"`.
