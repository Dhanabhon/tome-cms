# Self-hosted SystemOne Implementation Plan

**Status:** Deferred on 2026-09-21. Nothing here is built. Resume at Step 1: the measurement
decides which model ships, or whether anything does.

**Goal:** An owner who does not want to depend on TypeSafe.AI can get the same category and
excerpt suggestions from a model running on their own VPS, next to TomeCMS, with no article
text leaving the machine.

**Tech stack:** Astro 5 SSR, TypeScript, zod 4, Kysely/Postgres, Docker Compose; Python 3.12,
PyTorch (CPU), FastAPI for the model service.

Line numbers below are as of 0.4.0 (`c622f57`).

## Why this is small

The `typesafe` plugin (`1d76d01`) posts to `https://api.typesafe.ai/v1/systemone`. Two open
models (both Apache-2.0) answer the same typed questions -- `noul`, `choice`, `score` -- about
a `state`:

- **OpenThai-SystemOne** (iApp) ships a FastAPI server with the same contract:
  `POST /v1/systemone` takes `{state, model, questions}` and answers `answers.{id}.noul` or
  `answers.{id}.{choice, confidence}`.
- **Laya** (convaiinnovations) has a Python `system_one()` that returns the same shape, and no
  HTTP server.

The zod schemas in `src/plugins/typesafe/api.ts` already parse both answers, and every question
in `src/plugins/typesafe/questions.ts` can be asked unchanged. What differs is where a request
goes, what key it carries and how long it may take.

## Decisions

1. The model runs on the same VPS as TomeCMS, on CPU, reachable only on the Compose network.
2. It is its own plugin with the neutral id **`systemone`**. The id is stored in
   `plugin_settings.id`, so it must outlive whichever model is behind it; the display name can
   change. It has no admin fields: the server's address is the operator's, in the environment.
3. It answers both hooks, `categoryLikelihoods` and `pickExcerpt`, and is measured against
   TypeSafe before it merges.
4. The model is chosen by measurement: OpenThai fp32, OpenThai bf16 and laya-multilingual on
   the same VPS with the same articles.

## Candidates

Estimates from each model's weights and inference code; Step 1 replaces them with measurements.
On CPU both run fp32 by default: OpenThai's `SystemOneClient` picks fp32 off CUDA, and Laya
builds its encoder with `AutoModel.from_config` and disables autocast off CUDA.

| | OpenThai-SystemOne | laya-multilingual |
|---|---|---|
| Architecture | Qwen3.5-0.8B decoder + 256-way slot head, 0.75B | mmBERT-base encoder + decision head, 322M |
| Pinned | HF rev `6f5fee848c8dab6f0df30adccdf1881030d7f61f`, PyPI `openthai-systemone==0.1.0` | HF rev `1c5edc17a7acd8701df6fc341c0d179f1c62c982`, PyPI `laya==0.3.4` |
| Service RAM | ~4-4.5 GB fp32, ~2-2.5 GB bf16 | ~2-2.5 GB fp32. Not `Router(preload=True)`: it loads all three checkpoints, 5 GB+ |
| Image | ~2.7 GB | ~1.9 GB |
| Work, 10 categories | ~2.3-3.0 TFLOP: reads the article once | ~2.9 TFLOP: reads ~768 tokens once per question |
| Work, excerpt | ~2.6-3.6 TFLOP | ~0.3 TFLOP |
| What it reads | the whole sample (4,000 / 6,000 characters) | the first ~768 tokens; each option cut to 48 tokens or fewer |
| Thai MASSIVE intent / ECE | 88.6% / ≤0.05 (model card) | 0.480 / 0.336 (Laya's `BENCHMARKS.md`, 20 options) |
| Minimum VPS, TomeCMS included | 4 vCPU / 8 GB (bf16: 4-6 GB if the CPU has bf16) | 4 vCPU / 4-6 GB |

Laya's English checkpoint cannot read Thai ("collapses on non-Latin scripts"), so only the
multilingual one is a candidate. Its own card says the base checkpoints are "not a zero-shot
decision engine" and ship over-confident; the multilingual config still has every temperature
at 1.0. `suggestionBands()` draws its lines at 0.7 and 0.3, and those lines only mean something
if the probabilities are calibrated.

## On the VPS

```
Internet ─HTTPS─► Caddy/nginx :443 ─► 127.0.0.1:4321 ─► app (Astro/Node)
                                                          │ Compose network
                        ┌─────────────────┬───────────────┼─────────────────────┐
                        ▼                 ▼               ▼
                  postgres:5432    seaweedfs:8333   systemone:8000   ◄── no ports:
                                                    the chosen model, CPU
                                                    pinned weights in the image, HF_HUB_OFFLINE=1
```

A suggestion goes: the button → `/api/admin/posts/suggest-categories` → `suggestCategories()`
(first 4,000 characters) → `findSuggester()` → `readEnabledPlugin('systemone')`, which now also
returns `{url, timeoutMs}` from the environment → `POST http://systemone:8000/v1/systemone` →
likelihoods → `suggestionBands()`, unchanged: the bands are the core's policy, not a plugin's.
Excerpts go the same way through `suggestExcerpt()` (first 6,000 characters).

| Concern | Setting | Why |
|---|---|---|
| Network | `systemone` has **no `ports:`**, and a test holds it to that | neither model authenticates; only this Compose project can reach it |
| CORS | `OPENTHAI_SYSTEMONE_CORS=` (empty; OpenThai only) | the server's default is `*` |
| Weights | downloaded at a pinned revision at build time; `HF_HUB_OFFLINE=1` | nothing is fetched at runtime, and no article leaves the VPS |
| Warm-up | the model loads at import, before uvicorn binds | OpenThai loads lazily, so the first owner to press a button would wait out the timeout |
| CPU | `cpus` and `OMP_NUM_THREADS` both from `${SYSTEMONE_THREADS:-3}` | PyTorch ignores the cgroup quota and would starve postgres and node |
| Memory | `mem_limit` = measured peak RSS × 1.3 | depends on the model and dtype that win |
| Health | `python -c` + `urllib` on `/healthz`, `start_period: 180s` | the slim image has no curl |
| App timeout | `TOME_CMS_SYSTEMONE_TIMEOUT_MS`, default from Step 1, at most 60000 | 60 s is the usual reverse-proxy read timeout |
| Otherwise | non-root; `app` does not `depends_on` it | TomeCMS must start without it |

---

## Step 1: measure (throwaway, never committed)

Run it on a VPS of the target class, 4 vCPU / 8 GB -- **not the live one**: OpenThai fp32 alone
takes ~4.5 GB and could get the site's postgres OOM-killed. One candidate at a time, each with
`--cpus=3 -e OMP_NUM_THREADS=3`.

1. **Payloads from the live site.** A tsx script reads ~20 published articles and the categories
   the owner assigned them (`post_category_assignments`), and builds each request with
   `categoryQuestions()`, `excerptCandidates()` and `excerptCriteria()`, so every candidate is
   asked exactly what the plugin will ask. One JSON file serves all three.
2. **Candidates.**
   - **A. OpenThai fp32:** `uvicorn warm:app` as in Step 3, timed with `curl -w '%{time_total}'`.
   - **B. OpenThai bf16:** first `grep -o -E 'avx512_bf16|amx_bf16' /proc/cpuinfo | sort -u`,
     then a `SystemOneClient(path, dtype=torch.bfloat16)`. Without either flag, one run is
     enough to confirm it is slow.
   - **C. laya-multilingual:** only `multilingual/*` at the pinned revision, one checkpoint
     loaded (no `Router(preload=True)`), `USE_TF=0`, `predict(state, questions)` on the same JSON.
     Read the code that runs before running it.
3. **For each:** load time, peak RSS (`/usr/bin/time -v` or `docker stats`), p50/p95 for a
   category request and an excerpt request.
4. **Against TypeSafe,** with the key the site already has, on the same articles:
   - whether each owner-assigned category lands in the likely or possible band;
   - how the probabilities spread around 0.7 and 0.3;
   - the excerpt each one picks, side by side for the owner to judge, and how often the pick is
     byte-for-byte one of the passages offered (`acceptedExcerpt` keeps nothing else).
5. The pinned package loads the pinned weights from a local directory with `HF_HUB_OFFLINE=1`.

**Choosing:**
1. A candidate qualifies if an owner-assigned category is in the likely or possible band for at
   least 16 of 20 articles, and its excerpt is usable for at least 14 of 20. (Starting values;
   move them if they turn out wrong.)
2. Of those that qualify, the one with the least RAM whose p95 is at most 30 s.
3. If none qualifies, stop: TypeSafe stays the only suggester.

Then: the timeout default is max(30 s, 2 × p95), capped at 60 s. If the winner qualifies on
categories but not excerpts, it ships without `pickExcerpt`, and `canSuggest` is split per
feature first -- today one flag draws both buttons, and an excerpt button with no picker behind
it would say the article has no good line, which would not be true.

## Step 2: tests first

- `tests/unit/env.test.ts` (the `valid` object and the bounds loop, as they are):
  - no URL passes and reads as undefined;
  - the timeout has its default, and above 60000 fails;
  - a URL with a path (`http://systemone:8000/v1/systemone`) fails;
  - in production `http://systemone:8000` and `https://ai.example.com` pass,
    `http://ai.example.com` fails.
- `tests/unit/typesafe-plugin-api.test.ts` (stub `fetch` as `plugin-guard.test.ts:11-15` does):
  - `key: null` sends no `authorization`; a key sends a bearer;
  - the request goes to the service's `endpoint` with its `model`;
  - a response that is not ok gives null;
  - a request that hangs gives null after `timeoutMs`.
- `tests/unit/auth-context.test.ts`, beside "publish the app only on loopback": `systemone` has
  no `ports`, its `profiles` are `['systemone']`, and `app` does not depend on it.
- `tests/integration/plugin-settings.test.ts`:
  - without the URL, `systemone` is not configured, and switching it on is `plugin_incomplete`;
  - with it, `readEnabledPlugin` returns `{url, timeoutMs}`;
  - a row still switched on after the URL is removed is skipped, and an enabled TypeSafe answers.
- `plugin-admin.test.ts` and `plugin-secrets.test.ts` already cover a new plugin: the hooks it
  declares, an icon from `ICONS`, and no import from `/server/`.

## Step 3: implementation

1. **`src/server/env.ts`**:
   - `TOME_CMS_SYSTEMONE_URL: z.url({ protocol: /^https?$/ }).optional()`;
   - `TOME_CMS_SYSTEMONE_TIMEOUT_MS: timeout('<from Step 1>', 60_000)`, with the existing helper;
   - an origin-only rule: widen the `TOME_CMS_PUBLIC_URL` check (`env.ts:53-58`) to this URL;
   - a production rule for which hosts may receive article text over plain http (see "Open
     decision").
2. **`src/plugins/contract.ts`**: a closed set of names,
   `PluginServerSetting = 'TOME_CMS_SYSTEMONE_URL' | 'TOME_CMS_SYSTEMONE_TIMEOUT_MS'`, and
   `server?: Readonly<Record<string, PluginServerSetting>>` on `PluginManifest`. The same
   reasoning as `PluginHookId`: a manifest can ask for these, and cannot ask for `DATABASE_URL`.
3. **`src/server/plugins/store.ts`**: `serverSettings(manifest)` reads `getServerEnv()` and
   returns the values by the plugin's keys, or null when one is missing. Used in `configured`
   (`:40`), in the `plugin_incomplete` check (`:115`), and in `readEnabledPlugin` (`:57-75`),
   which returns null when they are missing and merges them into the settings otherwise. They
   never reach `values`, so none of it is sent to a browser. This is also why the plugin cannot
   read the environment itself: `plugin-secrets.test.ts:46-55` fails any plugin that imports
   from `/server/`, and every caller -- sign-in, public pages, suggestions -- goes through here.
4. **`src/plugins/typesafe/api.ts`**: `ask`, `choose` and `request` take a
   `Service { endpoint; key: string | null; model; name; timeoutMs }` instead of a key.
   `authorization` only with a key; logs name `service.name`; `withRetry` unchanged.
5. **`src/plugins/typesafe/index.ts`**: the two hook bodies become exported
   `likelihoodsFrom(service | null, input)` and `excerptFrom(service | null, input)`. TypeSafe's
   hooks only build its service from `settings.apiKey` (its endpoint, `jev-latest`, 8000 ms).
6. **New `src/plugins/systemone/plugin.ts` and `index.ts`**:
   - manifest: `id: 'systemone'`, `icon: 'system'`, `name` after the winner (for example
     "OpenThai SystemOne"), `hooks: ['editorSuggestions']`, `settings: []`,
     `server: { url: 'TOME_CMS_SYSTEMONE_URL', timeoutMs: 'TOME_CMS_SYSTEMONE_TIMEOUT_MS' }`;
     the description says it runs on the owner's own server, sends nothing to a third party,
     and needs the systemone service started first;
   - `index.ts`: endpoint `new URL('/v1/systemone', settings.url)`, `key: null`,
     `model: 'systemone'` (a self-hosted server ignores it); `likelihoodsFrom` and `excerptFrom`
     from `../typesafe`, because it speaks the same protocol; `signInWidget` and `verifySignIn`
     as TypeSafe has them, because the contract requires them and `sign-in.ts:27-32` calls them.
7. **`src/plugins/registry.ts`, `manifests.ts`**: `systemone` above `typesafe`, with a comment:
   when both are on and set up, the one on the owner's server answers.
8. **`src/components/admin/PluginManager.tsx:216`, `src/lib/admin-i18n.ts`**: an unconfigured
   plugin whose manifest has `server` shows the core's `plugins.needsServer` (en/th), naming the
   variables, instead of "fill in what it needs" -- there is nothing to fill in.
9. **`config/systemone/`**, after the winner:
   - always: `python:3.12-slim`; one `pip install` with
     `--extra-index-url https://download.pytorch.org/whl/cpu` and torch, transformers and the
     package pinned, so pip cannot pull the ~2.5 GB CUDA build; the weights at the pinned
     revision; `HF_HUB_OFFLINE=1`; non-root; `CMD uvicorn <module>:app --host 0.0.0.0 --port 8000`;
   - **OpenThai:** `warm.py`, two lines: import `app` and `get_client`, call `get_client()`. If
     bf16 won, `warm.py` builds its own `SystemOneClient(dtype=…)` and replaces
     `server.get_client`, with `SYSTEMONE_DTYPE` defaulting to `float32`, because CPUs differ.
     `OPENTHAI_SYSTEMONE_CORS=`;
   - **Laya:** `server.py`, ~20 lines of FastAPI: `POST /v1/systemone` calling `predict()`,
     `GET /healthz`, the multilingual checkpoint loaded at import. Plus fitting a temperature per
     (question type, option count) from articles that already have categories, since its config
     has none.
   - **`compose.yaml`**: a `systemone` service in `profiles: ["systemone"]`. Every variable gets
     a default (`${X:-n}`): `bootstrap-core.mjs:180` validates the whole file with
     `compose config --quiet`. Bootstrap starts services by name, so this one stays opt-in.
   - **`.dockerignore`**: add `config/systemone`, or the app's `COPY . .` takes it in and every
     change to it rebuilds the app.
   - `compose.managed.yaml` and `environmentContract` stay as they are; bumping the contract
     blocks updates.
10. **`.env.example`**: both variables, commented out -- an empty `TOME_CMS_SYSTEMONE_URL=`
    fails `z.url()`, and every route that parses the environment fails with it. **README**:
    lines 246-253 speak only of TypeSafe; add "Self-hosted suggestions (SystemOne)" -- which
    model and why, the VPS it needs (from Step 1), starting the service, the variables, moving to
    a new revision, and what stays on the machine.

## Open decision

Which hosts may receive article text over plain http in production. Trusting `isPublicHost()`
alone allows names without a dot, such as `systemone`, and private addresses; something stricter,
such as dotless service names only, is safer and less flexible when an operator moves the
service to another machine on the LAN. Write the failing tests first, then decide.

## Verification

1. `node --import tsx --test tests/unit/env.test.ts tests/unit/plugin-admin.test.ts tests/unit/plugin-secrets.test.ts tests/unit/typesafe-plugin-api.test.ts tests/unit/auth-context.test.ts`
2. `npm run test:unit && npm run check && npm run build`
3. `node scripts/test-foundation.mjs tests/integration/plugin-settings.test.ts`
4. `npm run test:e2e -- tests/e2e/editor-blocks.spec.ts` still passes.
5. `docker compose -f compose.yaml --env-file .env.local config --quiet`
6. On the VPS:
   - `docker compose -f compose.yaml --env-file .env.local --profile systemone up -d --build --wait systemone`;
   - from the app, `fetch('http://systemone:8000/healthz')` answers 200;
   - `ss -ltnp | grep 8000` prints nothing: no port on the host.
7. Before `TOME_CMS_SYSTEMONE_URL` is set, the card says it is not set up and the drawer names
   the variables (a scratch Playwright spec against a real stack).
8. With `TOME_CMS_SYSTEMONE_URL=http://systemone:8000` and `app` restarted: switch the plugin
   on, suggest categories and an excerpt on real articles, and watch `docker stats` stay inside
   the limits.
9. Stop `systemone` and press again: "Suggestions are unavailable right now", never "nothing fits".
10. A code review and a security review of the diff: it touches the environment, the network and
    Docker.

## Not in this plan

- Managed installs (`compose.managed.yaml`, an official image by digest): with the 1.0 managed flow.
- Auth and TLS for a model on another machine: when someone runs it there.
- Falling back from the owner's server to TypeSafe when it is down: if owners want both on.
- int8 quantization: if fp32 and bf16 are both too slow.
- Shipping both models: only the winner ships; the neutral id lets it be swapped without touching
  the database.
- Per-provider thresholds instead of 0.7/0.3: when there are enough of an owner's articles to
  measure against.
