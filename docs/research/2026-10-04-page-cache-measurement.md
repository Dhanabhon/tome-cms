# Page cache measurement: 1.15.0 against 1.16.0

Measured 2026-10-05, on this machine, before and after the page cache. Nothing in the repo changed
for the measurement; the scripts live outside it.

## Setup

- **Machine:** Apple M4 Max, 16 cores, 48 GiB, macOS 27.0.1, Node v22.22.3, ApacheBench 2.3. Docker
  29.8.2 for PostgreSQL 17 and SeaweedFS (the Foundation test stack, `compose.test.yaml`).
- **Mode:** a production build in both cases (`npm run build`, then `node dist/server/entry.mjs`),
  `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4400`. The client and the server share the machine,
  so these are best-case numbers with no network between them.
- **Before:** a throwaway worktree at `82e999e6` (1.15.0). **After:** the 1.16.0 release candidate, `2b6cdaf2`.
- **Same data:** one database seeded once with the content `tests/e2e/theme-shots.spec.ts` writes
  (ten English posts, five Thai editions, pages, navigation, slides for both languages, Paper theme).
  1.16.0 has no migration, so both builds ran against the same database, one after the other.
- **Production env rules:** `TOME_CMS_PUBLIC_URL=https://cms.example.com`, `S3_ENDPOINT` and
  `MEDIA_PUBLIC_URL` on `https://media.example.com`, and `S3_INTERNAL_ENDPOINT=http://127.0.0.1:59000`
  for the real object store. `ab` spoke plain HTTP to 127.0.0.1:4400 with `Host: cms.example.com`.
- **Procedure per build:** start the server, fetch each URL once, then three `ab` runs per URL in a row.

```sh
ab -c4 -n200 -H 'Host: cms.example.com' http://127.0.0.1:4400/en
ab -c4 -n200 -H 'Host: cms.example.com' http://127.0.0.1:4400/en/blog/all-the-blocks
```

No request failed in any run (`Failed requests: 0`).

## Requests per second

| Page | Build | Run 1 | Run 2 | Run 3 | Median |
|---|---|---:|---:|---:|---:|
| Home `/en` | 1.15.0 (before) | 652.15 | 776.20 | 832.18 | **776.20** |
| Home `/en` | 1.16.0 (after) | 4113.70 | 4894.16 | 5236.56 | **4894.16** |
| Post `/en/blog/all-the-blocks` | 1.15.0 (before) | 1109.98 | 1079.68 | 1186.86 | **1109.98** |
| Post `/en/blog/all-the-blocks` | 1.16.0 (after) | 4856.14 | 5421.96 | 5879.59 | **5421.96** |

| Page | Before (median) | After (median) | Ratio |
|---|---:|---:|---:|
| Home | 776.20 | 4894.16 | **6.3x** |
| Post | 1109.98 | 5421.96 | **4.9x** |

The spec's target was 5x or more for a cached home page and post. The home page clears it; the post
is just under, at 4.9x on the median and 4.95x on the best run against the best run. Within each series the runs climb
from the first to the third, on both builds, so some of the spread is the machine warming up rather
than the code.

## One request at a time

`curl -w '%{time_total}'` for single requests, in milliseconds. A miss is the first request for a
key; a hit is the second request for the same key. The home page has one key per category, so five
different categories stand in for five cold home-page misses. The first category request on the
after build, 34.6 ms, also paid for the server's own warm-up and is left in.

| Request | After: miss | After: hit | Before: first | Before: second |
|---|---:|---:|---:|---:|
| Home, `?category=Recipes` | 34.6 | 1.35 | 12.7 | 8.3 |
| Home, `?category=Field Notes` | 8.4 | 1.13 | 6.2 | 6.3 |
| Home, `?category=Empty Shelf` | 7.4 | 1.01 | 4.3 | 4.0 |
| Home, `?category=Uncategorized` | 10.0 | 1.16 | 4.4 | 7.0 |
| Home, `?category=สูตรขนม` | 12.2 | 0.74 | 5.6 | 4.3 |
| Post `why-we-bake-at-night` | 15.9 | 0.73 | 6.0 | 4.0 |
| Post `evening-bread` | 9.8 | 0.70 | 3.6 | 3.9 |
| Post `butter-and-patience` | 10.0 | 0.80 | 3.5 | 3.6 |
| Post `recipe-1` | 8.8 | 0.69 | 3.5 | 3.5 |
| Post `recipe-2` | 8.7 | 0.76 | 3.6 | 3.4 |

Five more timings of the plain home page on the before build: 4.5, 4.4, 4.7, 4.4, 4.5 ms; of the
post `all-the-blocks`: 3.8, 3.5, 3.5, 3.6, 3.6 ms. On the after build the same page answers in
0.6 to 0.7 ms once it is kept.

So a hit is about 0.7 to 1.3 ms, against 3.5 to 4.7 ms for a page drawn from the database on a
machine with the database next door. A miss on the after build took longer than the same request on
the before build:

- **Home:** misses 7.4 to 12.2 ms across four categories, and 34.6 ms for the first of all, against
  4.3 to 6.2 ms on the before build (12.7 ms for its first).
- **Post:** misses 8.7 to 10.0 ms across four posts, and 15.9 ms for the first, against 3.5 to
  3.6 ms on the before build (6.0 ms for its first).

Five samples a page and one machine: it is a hint that a miss now carries the cost of the expiry
lookups and the store, not a measurement of how much.

## For context: daedalus, 1.3.3

Measured earlier on the 1 GB test VPS, behind the real network path.

| Page | req/s |
|---|---:|
| Home | 25.4 |
| Post | 36.4 |

## daedalus after 1.16.0

Filled in by the owner after the update, with the same two `ab` commands against the public address
(`-c4 -n200`, three runs each, one request to warm each URL first).

| Page | Run 1 | Run 2 | Run 3 | Median |
|---|---:|---:|---:|---:|
| Home | | | | |
| Post | | | | |
