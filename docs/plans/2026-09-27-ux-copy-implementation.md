# UX copy fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply every finding of the UX copy review, and the terms of its glossary, to the admin, the tests and the documentation, in English and Thai.

**Architecture:** Copy lives in `src/lib/admin-i18n.ts` (`en` and `th`, same keys). A few strings are hardcoded in components and move into keys. Every label the documentation quotes changes in its English and Thai pages in the same task. Tests that assert changed words are updated in the same task. Screenshots are taken again once, at the end.

**Tech Stack:** Astro 7, React islands, `node --test`, Playwright, Starlight docs in `website/`.

**Spec:** `docs/specs/2026-09-27-ux-copy-review.md`. It holds the 41 findings (the `#` column), each with current copy, suggested copy and reason, plus the consistency glossary and the docs-impact line. The owner approved every finding, and every glossary term as recommended. The suggested copy is the starting point. Where a suggestion would read badly in its place, or contradicts the glossary, improve it and say so in the report.

## Global Constraints

- **Glossary, English:** passkey (lower case unless it starts a label), File Manager, post, page (lower case mid-sentence), Delete (permanent) / Remove (detach), sign in (verb) / sign-in (noun), image (and "profile picture" for the avatar), URL, redirect, visitor (site access) / reader (content), site, "Try again." Keep Save / Update as they are.
- **Glossary, Thai:** passkey, คลังไฟล์, บทความ, เพจ (never หน้า or หน้าเพจ for the content type), ลบ (Delete) / เอาออก (Remove), เข้าสู่ระบบ, ภาพ, รูปโปรไฟล์, URL, เปลี่ยนเส้นทาง, ผู้เข้าชม / ผู้อ่าน, เว็บไซต์ (เว็บ only in short labels), ลองอีกครั้ง (no กรุณา or โปรด), แนะนำ (not เสนอ) for suggestions.
- **Punctuation:** no em dash (—) or en dash (–) in any user-facing string or docs prose, in either language. English titles have no final period; English sentences do.
- **Thai:** reads as natural Thai written for a Thai reader, never word for word.
- **Placeholders:** every `{placeholder}` stays in both languages.
- **Docs:** follow the humanizer rules and quote admin labels verbatim from `src/lib/admin-i18n.ts`. Change the English page and its `th/` twin together. `npm --prefix website run check` must pass.
- **Tests:**
  - A changed string that a test asserts is updated in that test, in the same task. Find them with `rg` over `tests/`.
  - A new key in both languages gets a line in the matching unit test when the file already has one, such as `tests/unit/admin-i18n.test.ts`.
- **Gates, one at a time, in the foreground:** `npm run check`, `npm run test:unit`, `npm --prefix website run check`, and the e2e specs whose asserted words changed.
  - Before each Playwright run, `uptime` must show a 1-minute load under 15, and nothing may listen on port 55432 (`lsof -iTCP:55432 -sTCP:LISTEN`).
  - A spec file can sign in through `/recovery` at most 5 times.
  - Never touch the containers tome-cms-postgres-1 and tome-cms-seaweedfs-1, or port 4321.
- **Git:**
  - Work on branch `feat/ux-copy`, in the worktree `.worktrees/ux-copy`.
  - Never use `git stash`, `reset --hard`, `checkout --`, `clean`, `add -A` or `add .`. Stage by explicit path.
  - Write each commit message to a file and commit with `git commit -F <file>` in its own Bash call.
  - No attribution lines of any kind. No `--no-verify`. Do not push.

---

### Task 1: The System screen and the migration banner

Findings #1, #2, #3, #6, #24, #25.

**Files:** `src/lib/admin-i18n.ts`; `src/components/admin/UpdateManager.tsx`, where `check.updateMode` is rendered raw near `:288` and the install dialog is hardcoded near `:182`; `src/components/admin/AdminShell.astro`, the migration banner; `website/src/content/docs/running/updating.md` and `th/running/updating.md`; `tests/unit/update-admin.test.ts` and any test that asserts these words.

- [ ] The update mode shows as words, never the raw `check-only` / `managed`. Add a key per mode.
- [ ] The install confirmation's title, message and button come from keys, in both languages. The managed installer's own English reasons stay as they are.
- [ ] The migration banner leads with the consequence ("Saving will fail until…"), then lists the waiting names.
- [ ] `updates.checkOnly`, `updates.manualTransition`, `updates.manualTransitionRequired`, `updates.managed`, `updates.managedUnavailable` and `updates.contactOperator` say what the owner can do.
- [ ] The Updating page quotes the new labels. The screenshot alt text is updated in Task 6, when the picture is taken again.

### Task 2: Signing in, passkeys and recovery

Findings #5, #7, #22, #23, #29, #32, #35, and the glossary's Passkey and Sign in rows.

**Files:** `src/lib/admin-i18n.ts` (`auth.*`, `security.*`, `updates.noPasskey`, and every other "Passkey" mid-sentence); any component with a hardcoded "Passkey"; docs `admin/settings.md`, `start/first-run.md`, `running/recovery.md`, `start/what-is-tomecms.mdx`, and their `th/` twins; the tests that assert these words (`rg -n "Passkey" tests/`).

- [ ] "passkey" is lower case except where it starts a label ("Passkeys and recovery" stays).
- [ ] `auth.noPasskey` and the other "No Passkey was used/accepted" strings say what happened and how to go on.
- [ ] Take "credential" out of owner-facing copy.
- [ ] `security.useRecoveryCodeHint` says "your latest set", not "the set shown during installation".
- [ ] The passkey row's "Last used" reads naturally in both languages.
- [ ] Sign-in as a noun is hyphenated in English.
- [ ] Stored passkey names ("Recovery passkey", "Primary passkey") keep their stored values. Only the displayed copy changes.

### Task 3: Content terms

Findings #4, #15, #16, #17, #30, #31, #37, and the glossary rows Post, Page, File Manager, Delete vs Remove, Image, URL, Redirect, Visitor, Site.

**Files:** `src/lib/admin-i18n.ts`; components with hardcoded copy for these terms; the docs pages that quote the changed labels, in both languages, from the spec's docs-impact line and `rg` over `website/src/content/docs`; the tests that assert them.

- [ ] Thai says เพจ for the content type everywhere. English says post, not article. Redirects' chooser says "post or page".
- [ ] File Manager / คลังไฟล์ everywhere.
- [ ] Thai ลบ only for Delete, เอาออก for Remove.
- [ ] Thai แนะนำ for suggestions.
- [ ] English words inside Thai are replaced.
- [ ] Image, URL, redirect, visitor and site follow the glossary.

### Task 4: Jargon on editing screens, and every dash

Findings #8, #9, #10, #11, #18, #19, #20, #21, #26, #27, #28, #38.

**Files:** `src/lib/admin-i18n.ts` (`drawer.*`, `navigation.*`, `redirects.*`, `theme.*`, `plugins.*`, `slides.*`, `status.draft`, `row.missing`); the docs that quote them (`admin/publishing.md`, `admin/writing.md`, `admin/pages-and-menus.md`, `admin/themes.md`, `admin/home-slides.md`, `admin/plugins*`, and their `th/` twins); the tests that assert them.

- [ ] Slug, Meta title / description, MenuBar, "answers 404", "relative/absolute URL", "draws your site", and the plugin and theme developer notes become plain words for a site owner.
- [ ] The editor's language chips and the list badges read the same.
- [ ] No string in `admin-i18n.ts` contains — or –. Check with `rg -n "[—–]" src/lib/admin-i18n.ts`, which should find only the code comment on line 9.

### Task 5: Errors, empty states and consistency

Findings #12, #13, #14, #33, #34, #36, #39, #40, #41, and the glossary's Try again row.

**Files:** `src/lib/admin-i18n.ts` (`media.*`, `errors.*`, `editor.*`, `settings.incompleteResponse`, `stats.barTitle`, `navigation.empty`, `slides.empty`, `shell.poweredBy`); `src/pages/admin/index.astro` and `src/pages/admin/pages/index.astro` for the delete dialog; the tests that assert them.

- [ ] Every error says what happened and how to go on.
- [ ] Every empty state says how to start.
- [ ] Delete confirmations name the language, not a locale code.
- [ ] "Try again." and ลองอีกครั้ง are used everywhere.
- [ ] `stats.barTitle` has no plural-only count.
- [ ] `shell.poweredBy` becomes "Made by {company}". The footer test asserts the English wording.

### Task 6: Screenshots, the changelog, and the whole suite

**Files:** `website/src/assets/screenshots/**` (retaken with `npm run docs:screenshots`, every screen); the alt text of every docs page whose picture changed, in both languages; `CHANGELOG.md` (Unreleased > Changed).

- [ ] Take every screenshot again, and read each one to check it shows the new words.
- [ ] Update each image's alt text to what it now shows.
- [ ] Add one CHANGELOG line: the admin's words are plainer and consistent in both languages, with the glossary's main terms.
- [ ] Gates: `npm run check`, `npm run test:unit`, `npm --prefix website run check`, then the full `npx playwright test`.
