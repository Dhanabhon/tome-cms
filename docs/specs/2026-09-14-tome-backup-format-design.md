# `.tome` Backup Format — Design Note

> **Status: not scheduled.** This is a note for a future release, written while the
> surrounding code was fresh. Nothing here has been implemented, and nothing here is
> a commitment to implement it. Read the "What exists today" section before planning
> anything: most of this feature is already built, and the gap is narrower than it
> looks.

**Goal:** Let an owner take one file away from a TomeCMS install and put that install
back from it, on a different machine if need be.

---

## What exists today

`npm run backup` already captures a complete installation. It writes a **directory**:

```
<destination>/
  manifest.json     mode 0600, written with flag 'wx' so it never overwrites
  database.dump     pg_dump --format=custom --no-owner --no-privileges
  objects/          every media object mirrored from S3, laid out by object key
```

`manifest.json` is already a declared format with a version
(`src/update/backup.ts`):

```ts
interface BackupManifest {
  format: 'tomecms-backup';
  version: 1;
  createdAt: string;
  applicationVersion: string;
  config: { publicUrl: string; database: string; s3Endpoint: string; bucket: string };
  database: { file: 'database.dump'; sha256: string };
  records: BackupRecordCounts;
  objects: Array<{ key: string; contentType: string; sizeBytes: number; sha256: string }>;
}
```

`npm run restore:check` already proves a backup is restorable: it brings up a
**disposable** Compose project, restores the dump and the objects into it, and compares
the restored record counts and object checksums against the manifest.

So the integrity story is done. Every object carries a sha256, the dump carries a
sha256, and the restore is verified against a manifest rather than trusted.

### The actual gap

Two things are missing, and only one of them is the file format:

1. **There is no restore into a live installation.** `restore:check` restores into a
   throwaway project to verify. Nothing puts a backup back into the install the owner
   is running. This is the larger piece of work, and a `.tome` file without it is half
   a feature — a container nobody can open.
2. **A backup is a directory, so it is awkward to move.** Copying it anywhere loses
   the 0600 mode, and nothing binds the parts together: a directory with a
   half-copied `objects/` still looks like a backup until the checksums are run.

`.tome` addresses (2). It does not address (1), and should not ship before it.

---

## What `.tome` should be

**One file. A tar archive of exactly what `backup` writes today, with the manifest
first.**

```
mysite-2026-09-14.tome
  manifest.json     ← first entry, always
  database.dump
  objects/owners/<uuid>/2026/09/<uuid>.webp
  ...
```

### Why tar, not zip

- The archive is written once and read once, front to back. Tar streams; zip wants a
  central directory at the end, which means either buffering or seeking.
- `pg_dump --format=custom` is **already compressed**. Wrapping the archive in gzip
  or zstd re-compresses the largest member for close to nothing, and media (webp,
  avif, jpeg, png) is compressed too. An uncompressed tar is the honest default.
- Nothing about this file is meant to be browsed by hand. Random access buys nothing.

If compression is wanted later, compress per entry and record it in the manifest —
do not wrap the container.

### Why the manifest goes first

A reader can then validate `format`, `version` and `applicationVersion` before
consuming a single byte of anything else, and refuse early. A manifest at the end
means reading an entire backup to discover it cannot be restored.

### Open decisions

| Question | Notes |
|---|---|
| Container version | The manifest's `version: 1` describes the *manifest*. The container needs its own, or a future layout change is indistinguishable from a manifest change. Restore must **refuse** a version it does not know rather than guess. |
| Where the whole-file checksum lives | It cannot be inside the manifest it covers. Either a detached `mysite.tome.sha256`, or a trailer entry that covers everything before it. `backup.ts` already computes and prints `manifestSha256` — decide whether that stays the identity of a backup. |
| Encryption | Undecided, and the decision matters (see Security). |
| Restoring into a *different* install | The manifest records `publicUrl`, `database`, `s3Endpoint` and `bucket`. When they differ from the target, restore must either rewrite them or refuse. Silently restoring a backup that points at another site's bucket is the dangerous option. |

---

## Security

**A `.tome` file is credential material, not a document.** `database.dump` contains the
`passkey` table (credential public keys), `recovery_codes` (code hashes), `session`
tokens and the owner record. Anyone holding the file holds everything needed to stand
up a copy of the site.

Consequences for whatever gets built:

- Keep `mode 0600` and `flag: 'wx'` — the current backup already does both. A `.tome`
  writer must not relax either, and must never overwrite an existing file.
- Do not put a `.tome` anywhere the web server serves. Worth an explicit guard, not
  just documentation.
- Encryption is genuinely open. Optional passphrase encryption makes the file safe to
  hand around, at the cost of an owner who loses the passphrase losing the backup —
  which, for a self-hosted CMS whose owner already lost access once, is not a
  theoretical failure. If it ships, the unencrypted path must stay available and
  obvious.

---

## Interaction with reset

`admin:reset-installation` empties the 20 tables in `RESET_TABLES` and deliberately
preserves `app_metadata` plus Kysely's `kysely_migration` / `kysely_migration_lock`
(see `src/server/db/reset-tables.ts`). A restore from `pg_dump --format=custom` brings
its own schema and its own bookkeeping.

Restore-then-reset and reset-then-restore therefore do **not** compose for free.
Whichever order is supported has to be chosen, written down, and tested — most likely
"restore expects an empty schema and creates everything", which makes reset a
precondition rather than a peer.

---

## What not to change

- The manifest shape. It already carries everything `.tome` needs; adding a container
  does not justify reopening it.
- `restore:check`'s disposable-project verification. It is the only thing standing
  between "a backup exists" and "a backup works", and it should verify `.tome` files
  the same way it verifies directories today.
- The per-object sha256 list. It is what makes a partial archive detectable.

---

## Rough shape of the work, if it is ever scheduled

1. Live restore (`npm run restore -- <backup>`), directory input only. The larger half.
2. `.tome` writer — tar the directory, manifest first, 0600, `wx`.
3. `.tome` reader — accept a `.tome` anywhere a backup directory is accepted, in both
   `restore` and `restore:check`.
4. Container version refusal, and a test that a future version is refused rather than
   half-read.

Steps 2 and 3 are small. Step 1 is the feature.
