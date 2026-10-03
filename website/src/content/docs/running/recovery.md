---
title: Getting back in
description: Get back into the admin with a spare passkey, a recovery code or a link made on the server, and return a site to the first-run wizard.
sidebar:
  order: 5
---

TomeCMS has no password to reset. The owner signs in with a passkey, so the way back in after losing one depends on what you still have. Try a spare passkey first. Without one, a recovery code gets you in from any browser. With no code left either, a command on the server makes a one-time link that does the same.

## Before you need it

Both ways back are set up under "Security" in the admin.

- "Add a spare passkey" registers a second passkey, on another device. The sign-in page takes either one.
- The ten recovery codes from [the first-run wizard](/tome-cms/start/first-run/) each work once. To replace the set, press "Verify and create new codes" under "Recovery codes". The admin asks for a passkey first, then shows ten new codes, once. Every unused code of the old set stops working at that moment.

## With a recovery code

The admin's sign-in page links to `/recovery` with "Recover access". You can also open it yourself, for example `https://cms.example.com/recovery`. It is at that address whatever admin path you chose, and it speaks the site's default language.

1. Under "Use a recovery code", enter one unused code in "Recovery code" and press "Continue securely".
2. Your browser asks your device to create a new passkey. Create it in an ordinary browser window, as in the wizard.
3. When the passkey is saved, the admin opens, and you are signed in.

A code is spent as soon as the server accepts it, and every session the owner had is signed out at that moment. The code opens a one-time recovery link that lasts ten minutes. If the passkey is not created, the page keeps the link, and "Create recovery passkey" tries again while it lasts. After ten minutes, start over with another code.

A code that is wrong or already used gets "Recovery could not be started. Check the code and try again." The page allows five attempts in 30 minutes from one IP address, then asks you to wait.

The new passkey is saved as "Recovery passkey", and saving it removes every older passkey, the spare included. Once you are back in, add a spare again under "Security", and create a new set of codes if few are left.

## With a link made on the server

When there is no spare passkey and no code, make a recovery link on the server. Run the command in the checkout. It needs the checkout's packages, so if you have not yet run `npm ci` there for [backups](/tome-cms/running/backups/), run it once first.

```sh
npm run admin:recover
```

This first form changes nothing. It prints the site's name, its address and the owner's email, then `Inspection only. Re-run with --execute to create a one-time recovery link.` Check that it found the site you meant, then run:

```sh
npm run admin:recover -- --execute
```

It needs an interactive terminal, and asks you to type `RECOVER` followed by the site's origin, such as `RECOVER https://cms.example.com`. Typing it signs out every session the owner has. Any other answer stops with `Confirmation did not match. No changes were made.` A matching answer prints a link that works once and expires ten minutes later:

```text
One-time recovery link (expires 2026-09-25T09:10:00.000Z):
https://cms.example.com/recovery?context=...
```

The time is in UTC. Open the link on the device that is to hold the new passkey, and press "Create recovery passkey" under "Create a replacement passkey". From there it goes as with a code: the new passkey replaces every older one. The link leaves your saved recovery codes as they were.

The command reads its settings from the file `TOME_CMS_ENV_FILE` names, or else from `.env.local` in the checkout, or else from `/etc/tome-cms/tome-cms.env`. When it can read none of them, it stops with `No readable TomeCMS environment file found. Set TOME_CMS_ENV_FILE or create .env.local.`

## When the sign-in challenge will not load

With the Cloudflare Turnstile plugin on, the sign-in form shows a challenge. If it will not load in your browser, switch the plugin off from the checkout:

```sh
npm run plugin:disable turnstile
```

This keeps the plugin's settings. Run `npm run plugin:disable turnstile -- --forget` to clear them as well. The challenge guards signing in, never creating a passkey, so `/recovery` works whether the plugin is on or not.

## Starting over

A reset returns the site to the first-run wizard. It deletes the site's content and settings, every file in the bucket, and the owner's account with its passkeys, sessions and recovery codes. The database's tables and its record of the migrations stay, and so does `.env.local`, with the installation token in it.

Nothing brings a reset site back but a backup. If anything on the site may be wanted later, [back it up](/tome-cms/running/backups/) first.

1. Run `npm ci` once in the checkout, if you have not.
2. Stop the application:

   ```sh
   docker compose -f compose.yaml --env-file .env.local stop app
   ```

3. Preview what the reset would delete:

   ```sh
   npm run admin:reset-installation
   ```

   It prints the site's origin, the database, the bucket and the site's name, how many rows of each kind the database holds, and how many objects TomeCMS knows about and the bucket holds. It ends with `Dry run complete. No changes were made.`

4. Run the reset:

   ```sh
   npm run admin:reset-installation -- --execute
   ```

   It needs an interactive terminal. After the same preview, it prints a line for you to type back: `RESET` followed by the origin, the database and the bucket, such as `RESET https://cms.example.com tomecms tomecms-media`. Enter alone cancels, and a line that does not match changes nothing.

5. It deletes every object in the bucket, empties the tables, and checks that both are empty. It ends with `Reset complete. Restart TomeCMS and open /install.` Start the application again:

   ```sh
   docker compose -f compose.yaml --env-file .env.local start app
   ```

6. Open `/install` and go through [the wizard](/tome-cms/start/first-run/) with the same installation token.

The reset refuses, and changes nothing, in two cases. While an upload signed in the last few minutes could still arrive, it says `Recent signed uploads are still valid. Stop TomeCMS, wait five minutes, and run reset again.` When the bucket holds objects no table accounts for, it says `The media bucket contains objects not tracked by TomeCMS; no changes were made. Use a dedicated clean bucket.` Give the site a bucket of its own, because a reset empties it.

If the content or the files change while it runs, it stops and keeps the database as it was. The files are deleted before the tables are emptied, so a reset that fails partway through them keeps the database, but not the files it had already deleted.

## Recovering a managed installation

This section is for a managed install, from 1.0.0 on. A build from source keeps its settings in `.env.local` and has no updater.

If the managed installer fails after it has written its configuration, it keeps the configuration, the credentials, the images, the volumes and the logs. It also prints where it saved its diagnostics, `/var/log/tome-cms/install-<id>.json`. Only root can read that file, and passwords, tokens, secrets, keys and database addresses are removed from it. Read it with `sudo less`. A failure before that point removes only what the run itself had just created.

Keep the volumes and the secrets as they are: never run `down --volumes`, and never make new secrets to try again. Read the logs first:

```sh
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env logs --tail 100
sudo journalctl -u tomecms-updater -n 100 --no-pager
```

When the cause is fixed, carry on from the kept configuration. Check what the migrations did before running them again, because they only go forward. Then start the application, check that it is ready, and start the updater:

```sh
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env run --rm --no-deps --pull never app npm run db:migrate
sudo docker compose -p tomecms -f /opt/tome-cms/compose.managed.yaml \
  --env-file /etc/tome-cms/tome-cms.env \
  --env-file /var/lib/tome-cms/updater/image.env up -d --wait --no-deps --pull never app
curl --fail http://127.0.0.1:4321/health/ready
sudo systemctl daemon-reload
sudo systemctl enable --now tomecms-updater
sudo curl --unix-socket /run/tome-cms/updater.sock http://localhost/v1/status
```

A web update that fails and cannot safely go back to the previous application ends as `failed_manual_recovery`. It keeps its backup, and the admin cannot start another update until the server's operator has dealt with it. Do not delete `/var/lib/tome-cms/updater/job.json` to bring the button back.

If the update stopped before its backup, `"backupCreatedAt"` is `null` in the updater's status, and nothing changed. `sudo npm run updater:clear-failed`, run from a checkout of 1.0.3 or later, then sets the job aside, as [Troubleshooting](/tome-cms/running/troubleshooting/#the-update-stops-at-prepare-maintenance-and-the-site-answers-502) shows. It also sets aside a restore that kept the site in maintenance, as [below](#a-restore-that-kept-the-site-in-maintenance) shows. It refuses any other job.

Otherwise, stop the updater and the application, and copy the backup, which is under `/var/backups/tome-cms/`, off the server. [Check it](/tome-cms/running/backups/) with `npm run restore:check` before you change anything. Restoring the database and the files is done by hand. If the backup's `manifest.json` says `"scope": "database"`, it holds the database alone, taken before an update that brought no migration: leave the bucket as it is, or restore the files from an older full backup.

## A restore that kept the site in maintenance

`sudo tome restore` takes a safety backup first and puts it back when the restore fails, then opens the site again. In two cases it leaves the site in maintenance with the application stopped instead: when the safety backup cannot be put back, and when the restore found the application already stopped, as the next restore does after you set a failed one aside, which it then leaves stopped. `sudo tome status` shows it as a warning:

```text
Warning: a restore failed (rollback_failed) and keeps the site in maintenance.
```

What it means depends on the code in brackets:

- **`rollback_failed`.** Neither the backup nor the safety backup could be put back. The app is stopped, maintenance is on, and the state of the database is unknown. That is why nothing writes to it.
- **`restore_failed` or `safety_backup_failed`.** The restore began on an application that was already stopped, as the case above leaves it, so it did not start it. The safety backup was put back or nothing was replaced, so the database is as it was before the restore, and the application stays stopped as it was found.

Every other job is refused while this holds, with `An earlier restore failed and keeps the site in maintenance, so nothing else can run until it is recovered.` The sentence is followed by the same steps, and so is `tome status`. `tome export` and `tome import` answer with `The site is in maintenance, or the updater is busy. Try again when it is done.` instead.

1. From a checkout of v1.13.0 or newer, set the failed restore aside:

   ```sh
   cd /opt/tome-cms-src
   git fetch --depth 1 origin tag v1.13.0
   git checkout --detach v1.13.0
   npm ci
   sudo npm run updater:clear-failed
   ```

   It stops the updater service while it works and starts it again, keeps the restore's record beside the others, takes the site out of maintenance, and changes nothing else. The application stays stopped, so until step 2 the site shows errors, not the maintenance page: do step 2 promptly. It prints the paths you need, so copy them from its output, because `tome status` no longer shows a restore once it is set aside:

   ```text
   Set aside the restore of /var/backups/tome-cms/tomecms-20261001T100000000Z, whose safety backup could not be put back. Its record is kept as restore-job.20261003T110500000Z.json.
   The site is out of maintenance. Nothing else was changed: the app is still stopped.
   Next: sudo tome restore /var/backups/tome-cms/tomecms-20261003T110100000Z, to put the safety backup back, or the restore again.
   ```

   For a restore that failed on a site it found stopped, the first line says `which failed on a site it found stopped` in place of `whose safety backup could not be put back`, and the last is `Next: sudo tome restore <the backup>, to run the restore again.`
2. Restore again, which starts the application. Run the command on the `Next:` line. After `rollback_failed` it names the safety backup, taken just before the restore:

   ```sh
   sudo tome restore /var/backups/tome-cms/tomecms-20261003T110100000Z
   ```

   After the other codes the database is already as it was, so the `Next:` line names the backup you meant to restore, and you run it again. When you have no other plan, restore the newest backup.

   A database the failed rollback left empty or half made is no obstacle: the safety backup this restore takes first counts a missing table as holding nothing. If it still ends `safety_backup_failed`, see why with `sudo tome logs updater`. When that cannot be put right, put the safety backup's `database.dump` and `objects/` back by hand, as [Restoring a site](/tome-cms/running/backups/#restoring-a-site) shows for a build from source.

3. Check the site: open the admin, your latest posts and a few pictures. After `rollback_failed` you are restoring over a database in an unknown state, so check it before you trust it, and restore an older backup if it is wrong.

**A known gap.** A restore that began on a stopped application, as in step 2, is not remembered as such. Any start of the updater that finds a restore cut off in the middle, whether by a crash, `sudo systemctl restart tomecms-updater`, a reboot or a power cut, treats it as one that began on a running application. If it was cut off while preparing maintenance or taking its safety backup (steps 2 and 3), nothing had been replaced, so the updater starts the application on the database it found, and puts nothing back. If it was cut off from step 4 on, the updater puts back the safety backup that restore took, which was made from the database as it was found, and starts the application on that. Either way, if that database was the unknown one from the earlier failure, the site is now running on it. Check the site, as in step 3, before you trust it.
