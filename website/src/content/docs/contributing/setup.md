---
title: Setting up for development
description: Run TomeCMS on your own computer, with its database and file storage in Docker, on macOS or on Windows.
sidebar:
  order: 1
---

To work on TomeCMS itself, you run Astro's development server on your computer, with PostgreSQL and SeaweedFS, the S3-compatible file store, in Docker. One command prepares all of it. This setup is for development only. A site for readers is installed as [Installing on a VPS](/tome-cms/start/install/) describes.

## What you need

- Docker Desktop, running
- Node.js 22.12 or newer, with npm
- Git
- Ports `4321`, `5432` and `9000` free on your computer

Check the main tools:

```sh
node --version
npm --version
docker version
docker compose version
```

## On macOS

macOS is the main development workflow, and the one that is validated. From the project directory:

```sh
npm run dev:macos
```

The helper goes through these steps, and stops with a message at the first one that fails:

1. It checks that it is running on macOS, that `node`, `npm` and `docker` are installed, and that Docker Desktop is running.
2. It runs `npm ci` when the packages are not installed yet.
3. It checks that the three ports are free, and creates `.env.local` when there is none yet, with generated secrets and local addresses, readable by you alone.
4. It starts PostgreSQL and SeaweedFS and waits until both are ready. SeaweedFS creates the media bucket as it starts.
5. It applies the database migrations.
6. It prints the installer's address and the installation token.
7. It starts Astro.

You need no storage account and no license file. Open `http://localhost:4321/install` and go through [the first-run wizard](/tome-cms/start/first-run/), which asks for the installation token. To see the token again:

```sh
grep '^TOME_CMS_INSTALL_TOKEN=' .env.local
```

Keep the terminal open while you work. `Ctrl+C` stops Astro. PostgreSQL and SeaweedFS keep running in Docker until you stop them:

```sh
npm run infra:down
```

This removes the two containers. The database and the files stay in Docker volumes, and come back the next time the helper runs.

`.env.local` holds your local secrets, and the repository's `.gitignore` leaves it out.

## When the helper stops

| Message | What to do |
| --- | --- |
| `Error: Docker Desktop is not running.` | Start Docker Desktop and run the helper again. |
| `Port 5432 is unavailable.` | Something else is using that port. Stop it and run the helper again. The message names whichever of the three ports is taken. |
| `Existing .env.local needs updates; rerun with --force to merge values while preserving secrets.` | Newer code needs values your `.env.local` does not have yet. Look through the file, then run `npm run dev:macos -- --force`. |
| `Set .env.local permissions to 0600 before continuing.` | Others can read the file. Run `chmod 600 .env.local`, or run the helper with `-- --force`, which writes it back readable by you alone. |

`--force` merges the new defaults into `.env.local` and keeps every secret already in it.

## On Windows

Windows is a secondary workflow. Use Windows 11 with Docker Desktop, Node.js 22.12 or newer, npm, Git and PowerShell. In PowerShell, from the project directory:

```powershell
npm run dev:windows
```

The helper checks the same tools and runs the same setup as on macOS, and the wizard and the token work the same way. The token is kept in `.env.local` here too. macOS is the path that is validated today.

## Infrastructure and Astro in separate terminals

The helper ends by running Astro in the terminal it started in. To keep the two apart, so that you can restart Astro without preparing everything again, run the steps yourself. Install the packages first with `npm ci`, then:

```sh
npm run bootstrap:core
npm run dev
```

`bootstrap:core` is the helper without its first two steps and its last: it checks the ports, creates `.env.local` when there is none, starts PostgreSQL and SeaweedFS, applies the migrations, prints the token, and ends with `Start the application with npm run dev.` The database and the file store go on running in Docker, so the terminal is free again. `npm run dev` runs Astro in whichever terminal you start it in, and you can stop and start it there as often as you like.

These commands work on the same setup:

| Command | What it does |
| --- | --- |
| `npm run infra:up` | Starts PostgreSQL and SeaweedFS with the values in `.env.local`, and waits until they are ready |
| `npm run db:migrate` | Applies the migrations that have not run yet |
| `npm run media:cleanup` | Lists expired upload reservations and files whose deletion failed. With `-- --execute`, it asks you to type a confirmation, then removes them. |
| `npm run infra:down` | Stops PostgreSQL and SeaweedFS and removes their containers, keeping their data |
