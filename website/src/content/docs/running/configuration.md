---
title: Configuration
description: Every environment variable TomeCMS reads, its default, and the rules production holds the values to.
sidebar:
  order: 1
---

TomeCMS takes its settings from environment variables. On today's install they live in `.env.local` in the checkout, which the deploy helper writes the first time it runs and keeps readable by its owner only. [Installing on a VPS](/tome-cms/start/install/) walks through that run. The repository's `.env.example` lists the same names with placeholder values.

## Where the values are read

- The application container reads `.env.local`. Compose then sets two values itself, whatever the file says: `DATABASE_URL` points at the bundled PostgreSQL inside Compose's network, and `NODE_ENV` is `production`.
- The `npm run` scripts, such as `db:migrate`, `backup` and `admin:reset-installation`, load `.env.local` when it exists.
- `npm run admin:recover`, the command in [Getting back in](/tome-cms/running/recovery/), reads the file `TOME_CMS_ENV_FILE` names, or else `.env.local`, or else `/etc/tome-cms/tome-cms.env`.

`.env.local` puts every value between single quotes, as in `S3_REGION='us-east-1'`. Keep that form when you edit it.

## What the application reads

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `NODE_ENV` | Optional | `development` | `development`, `test` or `production`. `production` turns on the HTTPS rules below. |
| `DATABASE_URL` | Required | None | The PostgreSQL connection string, starting with `postgres://` or `postgresql://`. |
| `DATABASE_POOL_MAX` | Optional | `10` | The most database connections the application holds open, from 1 to 50. |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Optional | `5000` | How long to wait for a database connection, in milliseconds, from 100 to 60000. |
| `DATABASE_QUERY_TIMEOUT_MS` | Optional | `30000` | How long one query may run, in milliseconds, from 100 to 3600000. It limits the driver and PostgreSQL's own statement timeout. Raise it for a long migration. |
| `TOME_CMS_PUBLIC_URL` | Required | None | The CMS origin, such as `https://cms.example.com`, with no path, query or fragment. |
| `TOME_CMS_INSTALL_TOKEN` | Required | None | The token the first-run wizard asks for. At least 32 characters. |
| `BETTER_AUTH_SECRET` | Required | None | Better Auth, which runs sign-in, signs sessions with it. At least 32 characters. |
| `TOME_CMS_CONTEXT_SECRET` | Required | None | Signs the short-lived steps of installing and recovery and the API's page cursors, keys the rate limits, and encrypts plugins' secret settings. At least 32 characters. |
| `TOME_CMS_RECOVERY_PEPPER` | Required | None | Hashes the owner's recovery codes. At least 32 characters. |
| `S3_ENDPOINT` | Required | None | The object storage origin. The application reaches the bucket through it, and the browser uploads to it. |
| `S3_REGION` | Optional | `us-east-1` | The bucket's region. |
| `S3_ACCESS_KEY_ID` | Required | None | The object storage access key. |
| `S3_SECRET_ACCESS_KEY` | Required | None | The object storage secret key. At least 8 characters. |
| `S3_BUCKET` | Required | None | The bucket's name: 3 to 63 lower-case letters, digits, dots and hyphens, starting and ending with a letter or digit. The deploy helper uses `tomecms-media`. |
| `S3_FORCE_PATH_STYLE` | Optional | `true` | `true` puts the bucket in the path of each address, `false` in the host name. Keep `true` for the bundled SeaweedFS. |
| `MEDIA_PUBLIC_URL` | Required | None | Where readers load files from, with no query or fragment. The deploy helper builds it from `S3_ENDPOINT` and the bucket when you leave it out. |
| `TOME_CMS_FRONTEND_MODE` | Optional | `bundled` | `bundled` serves the public site. `headless` answers `404` for it and keeps the admin and the API. |
| `TOME_CMS_UPDATE_MODE` | Optional | `check-only` | `check-only` or `managed`. The deploy helper always writes `check-only`. Only the managed installer from 1.0.0, not released yet, writes `managed`. |
| `TOME_CMS_UPDATER_SOCKET` | Optional | `/run/tome-cms/updater.sock` | The updater service's socket on a managed install. It must be a `.sock` file directly under `/run/tome-cms/`. |
| `TOME_CMS_COUNTRY_HEADER` | Optional | `cf-ipcountry` | The request header a CDN puts the reader's country in, for Stats. It takes letters, digits and hyphens, and any other name falls back to `cf-ipcountry`. |
| `TOME_CMS_GEOIP_PATH` | Optional | `data/geoip/dbip-country-lite.mmdb` | The DB-IP Lite country database, used when no country header came. TomeCMS opens the file once, so restart TomeCMS after you add it. |

A missing required value, or a value outside the limits above, stops TomeCMS from serving the site, and `/health/ready` does not report it ready. The two Stats settings are the exception. Without the country database, countries show as unknown and the rest of the site works.

## What Compose and the command-line tools read

The application does not read these. Compose and the scripts take them from `.env.local` or from your shell.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | Required | None | The bundled PostgreSQL's password. The deploy helper generates it and builds `DATABASE_URL` from it. At least 8 characters, each a letter, a digit, `_` or `-`. |
| `APP_PORT` | Optional | `4321` | The port on `127.0.0.1` where the application listens. Point the reverse proxy at it. |
| `POSTGRES_PORT` | Optional | `5432` | The port on `127.0.0.1` where the bundled PostgreSQL listens. |
| `S3_PORT` | Optional | `9000` | The port on `127.0.0.1` where the bundled SeaweedFS answers S3 requests. Point the media origin's proxy at it. |
| `TOME_CMS_ENV_FILE` | Optional | `.env.local`, then `/etc/tome-cms/tome-cms.env` | The file `npm run admin:recover` reads its settings from. |

## Production needs HTTPS

When `NODE_ENV` is `production`, `TOME_CMS_PUBLIC_URL`, `S3_ENDPOINT` and `MEDIA_PUBLIC_URL` must each use `https://` on a public host that a browser can reach. TomeCMS refuses a private or reserved address, `localhost`, and names under `.local`, `.internal`, `.lan`, `.test`, `.example` and the other special-use suffixes. For `TOME_CMS_PUBLIC_URL`, use a host name rather than an IP address: passkeys refuse an IP address even when it is public. The deploy helper checks the same rules before it writes anything.

Outside production, `http://localhost` is the only plain HTTP address sign-in accepts.

## Object storage on another service

The bundled SeaweedFS is a single node, which suits one VPS. When you need high availability or more than one node, point the same `S3_*` settings and `MEDIA_PUBLIC_URL` at external object storage.

The browser puts uploads straight into the bucket, so the store needs a CORS rule for the site's origin, the value of `TOME_CMS_PUBLIC_URL`. The rule allows `PUT` with the `content-type`, `x-amz-checksum-sha256` and `content-disposition` headers. The last carries a document's name and how it opens, and is signed into the upload. In the form AWS S3 takes, the rule looks like this:

```json
[
  {
    "AllowedOrigins": ["https://cms.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "x-amz-checksum-sha256", "content-disposition"]
  }
]
```

The bundled SeaweedFS already allows what the site's origin asks for, and nothing to any other origin.

## Changing a value

Edit `.env.local` in the checkout, then run `./scripts/deploy-vps.sh` again. The helper keeps every value in the file, lines you added included, and starts the application with them. It always sets `NODE_ENV`, `TOME_CMS_UPDATE_MODE` and `TOME_CMS_UPDATER_SOCKET` itself. It takes from your shell only the required values, the three database tuning values and the three ports. If one you export differs from the file, it stops and asks for `--force`.

Once the site is installed, keep its secrets. A new `TOME_CMS_RECOVERY_PEPPER` stops every saved recovery code from working, and a new `TOME_CMS_CONTEXT_SECRET` leaves plugins' secret settings unreadable. Backups carry no credentials, so keep a private copy of `.env.local`, stored apart from them.

## What never to commit

Never commit `.env.local`, credentials, database dumps or object storage backups. The repository's `.gitignore` already leaves out `.env.local`, and the deploy helper writes the file readable by its owner only.
