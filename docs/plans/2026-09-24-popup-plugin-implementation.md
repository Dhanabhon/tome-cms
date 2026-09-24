# Popup Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Popup plugin that shows the owner's picture, words, button, decline and small print
in a modal over the public site, after a delay or as the reader leaves, remembered once closed.

**Architecture:** The plugin describes the popup through a new `sitePopup` hook and says when
to open it; the core checks what it was given in `publicAdditions`, draws a `<dialog>` in
`BaseLayout`, and the plugin's own `client.ts` only opens it and remembers its closing. Two new
setting kinds, `image` and `choice`, are validated by the plugin store, drawn by the plugin
settings form, and an `image` setting is named by the library when it refuses a deletion.

**Tech Stack:** Astro 7 SSR, React 18 islands, Kysely on PostgreSQL 17, zod 4, `node --test`,
Playwright.

**Spec:** [docs/specs/2026-09-24-popup-plugin-design.md](../specs/2026-09-24-popup-plugin-design.md)

## Global Constraints

- The popup has no form field. Its button is a link: a path on this site or https, checked by the existing `safeHref` in `src/server/plugins/public.ts`.
- A plugin never supplies markup. `sitePopup` returns data; the core draws.
- At most one popup a page, the first enabled plugin's to answer.
- Triggers: `delay` (5, 10 or 20 seconds; fallback 10) or `exit` (pointer through the top edge where the pointer is fine; past half the page where it is coarse).
- Closed in any way — ✕, decline, Esc, backdrop, the action — it is remembered in `localStorage` under its `dismissKey`, derived from its content. `#popup-preview` opens it at once regardless.
- It never opens over another open modal dialog.
- The picture is `alt=""`, has its width and height, and is `loading="lazy"`.
- A picture held by a plugin `image` setting cannot be deleted from the library, and the refusal names the plugin.
- Every user-visible string is the copy this plan gives, in English and Thai. `const th: typeof en` makes a missing Thai key a type error.
- Commits: write the message to a file under the scratchpad, then `git commit -F <file>` as its own command. Stage by explicit path, never `git add -A`. No attribution lines of any kind. Never `git stash`, `git checkout --`, `git reset --hard` or `git clean`. `--no-verify` is blocked.
- `npm run test:unit` and `npm run check` (0 errors, 0 warnings; the baseline has 3 hints) pass before every commit, run one after the other and never beside a browser test. `tests/unit/managed-installer.test.ts` fails under load; if it fails, re-run that file alone before believing it. Use a Bash timeout of 600000.
- Integration tests run with `node scripts/test-foundation.mjs <file>`. Browser specs run with `npm run test:e2e -- tests/e2e/<file> --project=desktop`, then `rm -rf test-results`.
- Never touch the owner's `tome-cms-postgres-1`, `tome-cms-seaweedfs-1` or the dev server on 4321.
- Every guard a task adds is checked by putting back the bug it guards against, and the report says what the failure read.
- The shell is zsh: quote every glob and every path with brackets.

---

### Task 1: The plugin and the contract it needs

**Files:**
- Modify: `src/plugins/contract.ts`
- Create: `src/plugins/popup/plugin.ts`, `src/plugins/popup/index.ts`
- Modify: `src/plugins/registry.ts`, `src/plugins/manifests.ts`, `src/lib/icons.ts`
- Modify: `tests/unit/plugin-admin.test.ts`
- Create: `tests/unit/popup-plugin.test.ts`

**Interfaces:**
- Produces, in `src/plugins/contract.ts`:
  - `PluginSetting.kind` gains `'choice' | 'image'`; `PluginSetting.options?: readonly PluginSettingOption[]`; `interface PluginSettingOption { label: { en: string; th: string }; value: string }`.
  - `PluginManifest.previewHref?: string`.
  - `interface SitePopup { imageId?: string; heading: string; text?: string; action: { href: string; label: string }; decline?: string; finePrint?: string; trigger: 'delay' | 'exit'; delaySeconds?: number; dismissKey: string }`.
  - `Plugin.sitePopup?(settings: PluginSettings, page: PublicPage): SitePopup | null`.
- Produces: the plugin `popup` (manifest, `sitePopup`, `publicClient`), registered, and the icon `popup`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/popup-plugin.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { publicClient, sitePopup } from '../../src/plugins/popup';

const home = { kind: 'home', locale: 'th' } as const;
const thai = {
  actionHref: '/th/deals', actionTh: 'รับส่วนลด', headingTh: 'ดีลร้อนแรง', textTh: 'ลด 15%',
};
const english = {
  actionEn: 'Claim my savings', actionHref: '/th/deals', declineEn: 'Maybe later', finePrintEn: 'Exclusions apply.',
  headingEn: 'Hottest deals',
};

test('the page’s own language is used whole when it has a heading', () => {
  const popup = sitePopup({ ...thai, ...english }, home)!;
  assert.equal(popup.heading, 'ดีลร้อนแรง');
  assert.equal(popup.text, 'ลด 15%');
  assert.equal(popup.action.label, 'รับส่วนลด');
  assert.equal(popup.decline, undefined, 'the English decline is not borrowed');
  assert.equal(popup.finePrint, undefined, 'nor its small print');
});

test('a language with no heading shows the other language’s popup, whole', () => {
  const popup = sitePopup({ ...english, textTh: 'ข้อความไทยที่ไม่มีหัวข้อ' }, home)!;
  assert.equal(popup.heading, 'Hottest deals');
  assert.equal(popup.text, undefined, 'the Thai message does not ride along');
  assert.equal(popup.decline, 'Maybe later');
  assert.equal(popup.finePrint, 'Exclusions apply.');
});

test('a popup needs a heading, a button and a link', () => {
  assert.equal(sitePopup({}, home), null);
  assert.equal(sitePopup({ ...thai, actionTh: '' }, home), null, 'no button text');
  assert.equal(sitePopup({ ...thai, actionHref: '' }, home), null, 'no link');
  assert.equal(sitePopup({ ...thai, headingTh: '   ' }, home), null, 'a heading of spaces is none');
});

test('it opens when and where it was told', () => {
  assert.deepEqual(
    [sitePopup(thai, home)!.trigger, sitePopup(thai, home)!.delaySeconds],
    ['delay', 10],
    'a delay of ten seconds until told otherwise',
  );
  assert.equal(sitePopup({ ...thai, delay: '5' }, home)!.delaySeconds, 5);
  assert.equal(sitePopup({ ...thai, delay: '7' }, home)!.delaySeconds, 10, 'a delay not on offer is the fallback');
  assert.equal(sitePopup({ ...thai, trigger: 'exit' }, home)!.trigger, 'exit');
  assert.equal(sitePopup({ ...thai, pages: 'home' }, { kind: 'post', locale: 'th' }), null, 'home only means not on an article');
  assert.ok(sitePopup({ ...thai, pages: 'home' }, home));
  assert.ok(sitePopup({ ...thai, pages: 'all' }, { kind: 'page', locale: 'th' }));
});

test('the dismiss key changes with the popup and only with it', () => {
  const key = sitePopup(thai, home)!.dismissKey;
  assert.match(key, /^popup-[a-z0-9]+$/);
  assert.equal(sitePopup({ ...thai }, home)!.dismissKey, key, 'the same popup, the same key');
  assert.equal(sitePopup({ ...thai, delay: '20' }, home)!.dismissKey, key, 'timing is not content');
  assert.notEqual(sitePopup({ ...thai, headingTh: 'ดีลใหม่' }, home)!.dismissKey, key);
  assert.notEqual(sitePopup({ ...thai, actionHref: '/th/other' }, home)!.dismissKey, key);
  assert.notEqual(sitePopup({ ...thai, image: '0f8fad5b-d9cb-469f-a165-70867728950e' }, home)!.dismissKey, key);
});

test('the picture is passed on by id, and the browser code runs only with a popup', () => {
  assert.equal(sitePopup({ ...thai, image: '0f8fad5b-d9cb-469f-a165-70867728950e' }, home)!.imageId, '0f8fad5b-d9cb-469f-a165-70867728950e');
  assert.equal(sitePopup(thai, home)!.imageId, undefined);
  assert.deepEqual(publicClient(thai, home), {});
  assert.equal(publicClient({}, home), null);
});
```

In `tests/unit/plugin-admin.test.ts`, add after the first test:

```ts
test('a choice lists its options with its fallback among them, and nothing else lists options', () => {
  for (const manifest of PLUGIN_MANIFESTS) {
    for (const setting of manifest.settings) {
      if (setting.kind === 'choice') {
        assert.ok(setting.options?.length, `${manifest.id}.${setting.key} offers no options`);
        assert.ok(
          setting.options!.some((option) => option.value === setting.fallback),
          `${manifest.id}.${setting.key} falls back to a value it does not offer`,
        );
      } else {
        assert.equal(setting.options, undefined, `${manifest.id}.${setting.key} lists options it cannot use`);
      }
    }
  }
});

test('the popup plugin answers both halves of a public page', async () => {
  const plugin = await loadPlugin('popup');
  assert.equal(typeof plugin?.sitePopup, 'function');
  assert.equal(typeof plugin?.publicClient, 'function');
});
```

and in the first test, widen the `publicPage` assertion to accept a popup:

```ts
      assert.ok(
        typeof plugin.siteNotice === 'function' || typeof plugin.sitePopup === 'function'
          || typeof plugin.publicClient === 'function',
        `${manifest.id} claims publicPage and adds nothing to a public page`,
      );
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/popup-plugin.test.ts tests/unit/plugin-admin.test.ts`
Expected: FAIL, `Cannot find module '../../src/plugins/popup'`.

- [ ] **Step 3: Widen the contract**

In `src/plugins/contract.ts`:

1. Above `export interface PluginSetting`, add:

```ts
/** One answer a 'choice' offers: what is stored, and what the owner reads. */
export interface PluginSettingOption {
  label: { en: string; th: string };
  value: string;
}
```

2. In `PluginSetting`, replace the `kind` line and its comment with:

```ts
  /**
   * A secret is encrypted at rest and never sent to a browser -- only whether it is set.
   * A switch is 'on' or 'off'. A colour is `#rrggbb`, which is the one shape that is safe to
   * put in a style attribute on a page every reader loads, so it is the only one accepted.
   * A choice is one of its `options`. An image is the id of a ready picture in this owner's
   * library, which the library then will not delete from under it.
   */
  kind: 'choice' | 'color' | 'image' | 'secret' | 'switch' | 'text';
```

and after `fallback`, add:

```ts
  /** Required by 'choice', and the only values a write may store for it. */
  options?: readonly PluginSettingOption[];
```

3. In `PluginManifest`, after `name`, add:

```ts
  /** A public address that shows this plugin at once, for the owner to look at. */
  previewHref?: string;
```

4. After `SiteNotice`, add:

```ts
/**
 * A box over the page: one picture from the library, words, and one link -- not markup, for
 * the reason the notice is not markup. The core draws it, checks the link as it checks the
 * notice's, and draws the picture only while it is still a ready image of this owner's.
 */
export interface SitePopup {
  action: { href: string; label: string };
  /** The words on the button that closes it. Absent means the core's. */
  decline?: string;
  /** Seconds, for `trigger: 'delay'`. */
  delaySeconds?: number;
  /** What closing it is remembered under. Derive it from its content and a new popup is shown again. */
  dismissKey: string;
  finePrint?: string;
  heading: string;
  imageId?: string;
  text?: string;
  trigger: 'delay' | 'exit';
}
```

5. In `interface Plugin`, after `siteNotice`, add:

```ts
  /** Null when this plugin has no popup for this page. */
  sitePopup?(settings: PluginSettings, page: PublicPage): SitePopup | null;
```

- [ ] **Step 4: Write the plugin**

Create `src/plugins/popup/plugin.ts`:

```ts
import type { PluginManifest } from '../contract';

/** Kept apart from the hooks so the admin can name the plugin without loading it. */
export const manifest: PluginManifest = {
  description: {
    en: 'A box over the page with a picture, a few words and a button, opened after a moment or as the reader leaves.',
    th: 'กล่องที่ขึ้นเหนือหน้า มีรูป ข้อความสั้น ๆ และปุ่ม ขึ้นหลังรอสักครู่หรือตอนผู้อ่านกำลังจะออกจากหน้า',
  },
  hooks: ['publicPage'],
  icon: 'popup',
  id: 'popup',
  name: 'Popup',
  previewHref: '/#popup-preview',
  settings: [
    {
      key: 'image',
      kind: 'image',
      label: { en: 'Picture', th: 'รูปภาพ' },
      hint: {
        en: 'Optional. Beside the words, or above them on a phone.',
        th: 'ไม่บังคับ แสดงข้างข้อความ หรือเหนือข้อความบนมือถือ',
      },
      required: false,
    },
    {
      key: 'headingTh',
      kind: 'text',
      label: { en: 'Heading (Thai)', th: 'หัวข้อ (ไทย)' },
      hint: {
        en: 'A language with no heading shows the other language’s popup instead.',
        th: 'ภาษาที่ไม่มีหัวข้อจะแสดง popup ของอีกภาษาแทน',
      },
      required: false,
    },
    { key: 'textTh', kind: 'text', label: { en: 'Message (Thai)', th: 'ข้อความ (ไทย)' }, required: false },
    { key: 'actionTh', kind: 'text', label: { en: 'Button text (Thai)', th: 'ข้อความบนปุ่ม (ไทย)' }, required: false },
    {
      key: 'declineTh',
      kind: 'text',
      label: { en: 'Decline (Thai)', th: 'คำปฏิเสธ (ไทย)' },
      hint: { en: 'Left empty: “ไม่ล่ะ ขอบคุณ”.', th: 'ถ้าเว้นว่างจะใช้ “ไม่ล่ะ ขอบคุณ”' },
      required: false,
    },
    { key: 'finePrintTh', kind: 'text', label: { en: 'Small print (Thai)', th: 'หมายเหตุตัวเล็ก (ไทย)' }, required: false },
    { key: 'headingEn', kind: 'text', label: { en: 'Heading (English)', th: 'หัวข้อ (อังกฤษ)' }, required: false },
    { key: 'textEn', kind: 'text', label: { en: 'Message (English)', th: 'ข้อความ (อังกฤษ)' }, required: false },
    { key: 'actionEn', kind: 'text', label: { en: 'Button text (English)', th: 'ข้อความบนปุ่ม (อังกฤษ)' }, required: false },
    {
      key: 'declineEn',
      kind: 'text',
      label: { en: 'Decline (English)', th: 'คำปฏิเสธ (อังกฤษ)' },
      hint: { en: 'Left empty: “No thanks”.', th: 'ถ้าเว้นว่างจะใช้ “No thanks”' },
      required: false,
    },
    { key: 'finePrintEn', kind: 'text', label: { en: 'Small print (English)', th: 'หมายเหตุตัวเล็ก (อังกฤษ)' }, required: false },
    {
      key: 'actionHref',
      kind: 'text',
      label: { en: 'Button link', th: 'ลิงก์ของปุ่ม' },
      hint: {
        en: 'A path on this site, or an https address; anything else is ignored.',
        th: 'ใส่เป็นพาธในเว็บนี้ หรือที่อยู่ https เท่านั้น นอกนั้นจะถูกละเว้น',
      },
      required: true,
    },
    {
      fallback: 'delay',
      key: 'trigger',
      kind: 'choice',
      label: { en: 'Opens', th: 'ขึ้นเมื่อ' },
      hint: {
        en: 'Leaving is a pointer heading out through the top of the window or, on a phone, reading past half the page.',
        th: 'การจะออกจากหน้าคือเมาส์เลื่อนออกทางขอบบนของหน้าต่าง หรือบนมือถือคือเลื่อนอ่านเกินครึ่งหน้า',
      },
      options: [
        { label: { en: 'After a moment', th: 'หลังรอสักครู่' }, value: 'delay' },
        { label: { en: 'As the reader leaves', th: 'ตอนผู้อ่านจะออกจากหน้า' }, value: 'exit' },
      ],
      required: false,
    },
    {
      fallback: '10',
      key: 'delay',
      kind: 'choice',
      label: { en: 'After', th: 'รอ' },
      options: [
        { label: { en: '5 seconds', th: '5 วินาที' }, value: '5' },
        { label: { en: '10 seconds', th: '10 วินาที' }, value: '10' },
        { label: { en: '20 seconds', th: '20 วินาที' }, value: '20' },
      ],
      required: false,
    },
    {
      fallback: 'all',
      key: 'pages',
      kind: 'choice',
      label: { en: 'Pages', th: 'หน้าที่ขึ้น' },
      options: [
        { label: { en: 'Every page', th: 'ทุกหน้า' }, value: 'all' },
        { label: { en: 'The home page only', th: 'หน้าแรกเท่านั้น' }, value: 'home' },
      ],
      required: false,
    },
  ],
};
```

Create `src/plugins/popup/index.ts`:

```ts
import type { Plugin, PluginSettings, PublicPage, SignInVerdict, SignInWidget, SitePopup } from '../contract';

export { manifest } from './plugin';

/** Nothing to add to the sign-in: this plugin is about the page a reader sees. */
export function signInWidget(): SignInWidget | null {
  return null;
}

export async function verifySignIn(): Promise<SignInVerdict> {
  return { outcome: 'passed', detail: 'the popup does not guard anything' };
}

const DELAYS = new Set(['5', '10', '20']);

/** One language's words, trimmed. */
function words(settings: PluginSettings, language: 'En' | 'Th') {
  const read = (key: string) => settings[`${key}${language}`]?.trim() ?? '';
  return { action: read('action'), decline: read('decline'), finePrint: read('finePrint'), heading: read('heading'), text: read('text') };
}

/** The notice's hash, over a popup's content: a new popup is shown again, the same one is not. */
function hash(value: string): string {
  return [...value].reduce((total, character) => (total * 31 + character.codePointAt(0)!) >>> 0, 7).toString(36);
}

/**
 * The popup, in the language the page is read in when that language has one, and otherwise the
 * other language's whole -- never a Thai heading over an English button.
 */
export function sitePopup(settings: PluginSettings, page: PublicPage): SitePopup | null {
  if (settings.pages === 'home' && page.kind !== 'home') return null;
  const own = words(settings, page.locale === 'th' ? 'Th' : 'En');
  const chosen = own.heading ? own : words(settings, page.locale === 'th' ? 'En' : 'Th');
  const href = settings.actionHref?.trim() ?? '';
  if (!chosen.heading || !chosen.action || !href) return null;
  const imageId = settings.image?.trim() || undefined;
  return {
    action: { href, label: chosen.action },
    ...(chosen.decline ? { decline: chosen.decline } : {}),
    delaySeconds: Number(DELAYS.has(settings.delay ?? '') ? settings.delay : '10'),
    dismissKey: `popup-${hash(JSON.stringify([chosen, href, imageId ?? '']))}`,
    ...(chosen.finePrint ? { finePrint: chosen.finePrint } : {}),
    heading: chosen.heading,
    ...(imageId ? { imageId } : {}),
    ...(chosen.text ? { text: chosen.text } : {}),
    trigger: settings.trigger === 'exit' ? 'exit' : 'delay',
  };
}

/** The browser code opens it, so it runs only where there is something to open. */
export function publicClient(settings: PluginSettings, page: PublicPage) {
  return sitePopup(settings, page) ? {} : null;
}

const plugin: Plugin = { publicClient, signInWidget, sitePopup, verifySignIn };
export default plugin;
```

In `src/plugins/registry.ts`, add `popup: () => import('./popup'),` after `notice`.
In `src/plugins/manifests.ts`, import `{ manifest as popup } from './popup/plugin'` and list it
after `notice`: `[turnstile, notice, popup, lightbox, typesafe]`.
In `src/lib/icons.ts`, add after `plugins` (or at the end of `ICONS` if there is no `plugins` key):

```ts
  popup: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
```

- [ ] **Step 5: Run them to see them pass**

Run: `node --import tsx --test tests/unit/popup-plugin.test.ts tests/unit/plugin-admin.test.ts tests/unit/icons.test.ts`
Expected: PASS.

- [ ] **Step 6: Check the guards**

Put back each and watch a test fail, then undo:
- `const chosen = own.heading ? own : …` → take each field separately with `own.x || other.x` (the "used whole" tests fail);
- add `settings.delay` to the array `dismissKey` hashes (the "timing is not content" assertion fails);
- give the `trigger` setting `fallback: 'soon'` (the choice test fails).

- [ ] **Step 7: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(plugins): a popup plugin, and the contract it needs

The plugin describes a box over the page: a picture from the library, a
heading, a few words, a button that links somewhere, a decline and small
print, in the page's language or wholly in the other one, after a moment
or as the reader leaves. The contract gains the sitePopup hook, a choice
setting with its options, an image setting, and a preview address.
```

```bash
git add src/plugins/contract.ts src/plugins/popup/plugin.ts src/plugins/popup/index.ts src/plugins/registry.ts src/plugins/manifests.ts src/lib/icons.ts tests/unit/plugin-admin.test.ts tests/unit/popup-plugin.test.ts
```

---

### Task 2: The store keeps choices and pictures honest

**Files:**
- Modify: `src/server/plugins/store.ts` (`writePluginSettings`)
- Create: `tests/integration/popup-plugin-settings.test.ts`

**Interfaces:**
- Consumes: the popup manifest (Task 1): `image` (kind `image`), `trigger` (`choice`: `delay`, `exit`; fallback `delay`), `delay` (`choice`: `5`, `10`, `20`; fallback `10`), `pages` (`choice`: `all`, `home`; fallback `all`).
- Produces: `writePluginSettings` refuses a `choice` value not among its options and an `image` value that is not a ready image of this owner's, with `HttpError(400)`; it stores an image id in lower case.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/popup-plugin-settings.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('a choice is one of its options and a picture is a ready image of this owner’s', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { readPluginStates, writePluginSettings } = await import('../../src/server/plugins/store');
  context.after(closeDatabase);

  await migrateToLatest();
  const owner = async (email: string) => {
    const id = randomUUID();
    await db.insertInto('user').values({ id, name: 'Owner', email, emailVerified: true, image: null, role: 'owner' }).execute();
    return id;
  };
  const ownerId = await owner('popup@example.invalid');
  const strangerId = await owner('popup-stranger@example.invalid');
  const media = async (who: string, values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    owner_id: who, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready', delete_error_code: null,
    object_key: `owners/${who}/2026/09/${randomUUID()}`, original_name: 'file', mime_type: 'image/jpeg',
    size_bytes: 400_000, width: 1600, height: 900, alt_text: null, ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const picture = await media(ownerId, {});
  const guide = await media(ownerId, { mime_type: 'application/pdf', width: null, height: null });
  const theirs = await media(strangerId, {});

  const state = async () => (await readPluginStates(ownerId)).find((plugin) => plugin.id === 'popup')!;
  assert.deepEqual(
    [(await state()).values.trigger, (await state()).values.delay, (await state()).values.pages],
    ['delay', '10', 'all'],
    'an untouched popup reads its fallbacks',
  );

  const refused = async (why: string, values: Record<string, string>) => {
    await assert.rejects(
      writePluginSettings(ownerId, { enabled: false, id: 'popup', values }),
      (error: unknown) => error instanceof HttpError && error.status === 400,
      why,
    );
  };
  await refused('a trigger it does not offer', { trigger: 'sometimes' });
  await refused('a delay it does not offer', { delay: '7' });
  await refused('an id that is not an id', { image: 'lake.jpg' });
  await refused('a document for a picture', { image: guide });
  await refused('another owner’s picture', { image: theirs });
  await refused('a picture that is not there', { image: randomUUID() });

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { delay: '20', image: picture.toUpperCase(), trigger: 'exit' } });
  assert.equal((await state()).values.image, picture, 'the picture is kept, in lower case');
  assert.equal((await state()).values.trigger, 'exit');
  assert.equal((await state()).values.delay, '20');

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { image: '' } });
  assert.equal((await state()).values.image, '', 'an emptied picture is none');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/test-foundation.mjs tests/integration/popup-plugin-settings.test.ts`
Expected: FAIL at "a trigger it does not offer" (the write is accepted).

- [ ] **Step 3: Check them in the store**

In `src/server/plugins/store.ts`, add imports:

```ts
import { isUuid } from '../media/keys';
import { assertReadyMediaReferences } from '../media/service';
```

In `writePluginSettings`, after the `color` check, add:

```ts
    if (supplied !== undefined && setting.kind === 'choice' && !setting.options?.some((option) => option.value === supplied)) {
      throw new HttpError(400, `${setting.label.en} is one of its choices.`, { code: 'plugin_setting_invalid' });
    }
    if (supplied && setting.kind === 'image') {
      // An id the library knows, of a picture that is ready and this owner's -- the store is the
      // one place every write passes, and the library refuses to delete what this names.
      if (!isUuid(supplied)) throw new HttpError(400, 'Choose media from this site.', { code: 'plugin_setting_invalid' });
      await assertReadyMediaReferences(db, ownerId, [supplied.toLowerCase()]);
    }
```

and change the line that keeps a value to lower-case an image as it does a colour:

```ts
      settings[setting.key] = setting.kind === 'color' || setting.kind === 'image' ? kept.toLowerCase() : kept;
```

- [ ] **Step 4: Run it to see it pass**

Run: `node scripts/test-foundation.mjs tests/integration/popup-plugin-settings.test.ts`, then
`node scripts/test-foundation.mjs tests/integration/plugin-settings.test.ts` (still passes).
Expected: PASS, PASS.

- [ ] **Step 5: Check the guards**

Put back each and watch the test fail, then undo: remove the `choice` check; remove the
`assertReadyMediaReferences` call; drop `|| setting.kind === 'image'` from the lower-casing.

- [ ] **Step 6: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(plugins): the store keeps a choice and a picture honest

A choice is one of the options its manifest offers, and a picture is a
ready image in this owner's library, stored by its id in lower case.
Anything else is refused as a bad request.
```

```bash
git add src/server/plugins/store.ts tests/integration/popup-plugin-settings.test.ts
```

---

### Task 3: The library names the plugin that holds a picture

**Files:**
- Modify: `src/types/cms.ts` (`MediaReferences`)
- Modify: `src/server/media/service.ts` (`findMediaReferences`)
- Modify: `src/components/admin/MediaLibrary.tsx`
- Create: `tests/integration/popup-plugin-media.test.ts`

**Interfaces:**
- Consumes: `PLUGIN_MANIFESTS` (`src/plugins/manifests.ts`); a setting of kind `image` (Task 1); the store (Task 2).
- Produces: `MediaReferences.plugins: Array<{ id: string; name: string }>` and `MediaReferences.counts.plugins: number`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/popup-plugin-media.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { MediaReferences } from '../../src/types/cms';

test('a picture a plugin holds is refused deletion, on or off, and the refusal names the plugin', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { HttpError } = await import('../../src/server/http/errors');
  const { writePluginSettings } = await import('../../src/server/plugins/store');
  const { deleteMedia } = await import('../../src/server/media/service');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'popup-media@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const picture = (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, alt_text: '', state: 'ready',
    delete_error_code: null, object_key: `owners/${ownerId}/2026/09/${randomUUID()}.jpg`, original_name: 'deal.jpg',
    mime_type: 'image/jpeg', size_bytes: 400_000, width: 1600, height: 900,
  }).returning('id').executeTakeFirstOrThrow()).id;

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { image: picture } });

  await assert.rejects(deleteMedia(ownerId, picture), (error: unknown) => {
    assert.ok(error instanceof HttpError && error.status === 409, 'refused as a conflict, though the plugin is off');
    const references = (error as { details?: { references?: MediaReferences } }).details?.references;
    assert.deepEqual(references?.plugins, [{ id: 'popup', name: 'Popup' }]);
    assert.equal(references?.counts.plugins, 1);
    return true;
  });

  await writePluginSettings(ownerId, { enabled: false, id: 'popup', values: { image: '' } });
  // The disposable stack runs storage, and deleting an object that was never uploaded succeeds.
  await deleteMedia(ownerId, picture);
  const left = await db.selectFrom('media_items').select('id').where('id', '=', picture).execute();
  assert.equal(left.length, 0, 'once let go, the plugin no longer holds it');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/test-foundation.mjs tests/integration/popup-plugin-media.test.ts`
Expected: FAIL: the first delete is not refused with 409.

If the final `deleteMedia` fails at storage rather than at the references, read the error: a
storage failure is outside this task, and the assertion that matters is the 409 above.

- [ ] **Step 3: Count the plugins**

In `src/types/cms.ts`, `MediaReferences`: add `plugins: number;` to `counts` (keep the keys
alphabetical, so after `pageContent`) and `plugins: Array<{ id: string; name: string }>;` as a
member (after `pages`).

In `src/server/media/service.ts`, import `PLUGIN_MANIFESTS` from `'../../plugins/manifests'`,
and add above `findMediaReferences`:

```ts
/** Each plugin with a picture setting, and the keys it keeps pictures under. */
const PLUGIN_PICTURES = PLUGIN_MANIFESTS
  .map(({ id, name, settings }) => ({ id, keys: settings.filter((setting) => setting.kind === 'image').map((setting) => setting.key), name }))
  .filter(({ keys }) => keys.length > 0);
```

In `findMediaReferences`, add a seventh query to the `Promise.all`, named `pluginRows`:

```ts
    trx.selectFrom('plugin_settings').select(['id', 'settings']).where('owner_id', '=', ownerId).execute(),
```

and after the `Promise.all`:

```ts
  // On or off: a plugin switched off still keeps the picture it will show when switched on.
  // ponytail: checked here but not locked; a plugin saving the same picture in the same
  // instant can slip past, and the popup then simply draws without it.
  const plugins = PLUGIN_PICTURES.filter(({ id: pluginId, keys }) => {
    const stored = pluginRows.find((row) => row.id === pluginId)?.settings as Record<string, unknown> | undefined;
    return keys.some((key) => stored?.[key] === id);
  }).map(({ id: pluginId, name }) => ({ id: pluginId, name }));
```

Return `plugins: plugins.length` in `counts` and `plugins` beside `pages`.

In `src/components/admin/MediaLibrary.tsx`:
- add `const [referencingPlugins, setReferencingPlugins] = useState<MediaReferences['plugins']>([]);` after the maintenance reference state;
- add `setReferencingPlugins([]);` beside every `setMaintenanceReference(false);`;
- add `setReferencingPlugins(deleteFailure.references.plugins ?? []);` after `setMaintenanceReference(...)`;
- in the delete alert, after the maintenance reference, add
  `{referencingPlugins.length > 0 && <ul>{referencingPlugins.map((plugin) => <li key={plugin.id}><a href="/admin/plugins">{plugin.name}</a></li>)}</ul>}`,
  and add `&& !referencingPlugins.length` to the condition that shows the retry button.

- [ ] **Step 4: Run it to see it pass**

Run: `node scripts/test-foundation.mjs tests/integration/popup-plugin-media.test.ts`, then
`node scripts/test-foundation.mjs tests/integration/home-slides-media.test.ts` and
`node scripts/test-foundation.mjs tests/integration/maintenance.test.ts` (both still pass).

- [ ] **Step 5: Check the guards**

Put back each and watch the test fail, then undo: filter `pluginRows` by `enabled = true`
(the "though the plugin is off" assertion fails); drop `plugins.length` from `counts` (the
delete goes through).

- [ ] **Step 6: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(media): a picture a plugin holds is not deleted from under it

The library looks in each plugin's picture settings, on or off, and its
refusal names the plugin, as it names a slide or the maintenance page.
```

```bash
git add src/types/cms.ts src/server/media/service.ts src/components/admin/MediaLibrary.tsx tests/integration/popup-plugin-media.test.ts
```

---

### Task 4: The settings form draws a picture, a choice and a preview

**Files:**
- Modify: `src/components/admin/PluginManager.tsx` (`PluginSetUp`, a new `PluginPicture`)
- Modify: `src/lib/admin-i18n.ts` (`plugins`, English and Thai)
- Modify: `src/styles/global.css`
- Modify: `tests/unit/plugin-admin.test.ts`

**Interfaces:**
- Consumes: `PluginSetting.kind` `image`/`choice`, `PluginSetting.options`, `PluginManifest.previewHref` (Task 1); the store (Task 2).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/plugin-admin.test.ts`:

```ts
test('a picture setting is chosen from the library and sent as its id', () => {
  // The picker the rest of the admin uses, and a plain field the form sends like any other.
  assert.match(SOURCE, /<MediaPicker kind="image"/);
  assert.match(SOURCE, /<input name=\{name\} type="hidden" value=\{mediaId\} \/>/);
});

test('a choice setting offers its options and only those', () => {
  assert.match(SOURCE, /options=\{\(setting\.options \?\? \[\]\)\.map\(\(option\) => \(\{ label: option\.label\[locale\], value: option\.value \}\)\)\}/);
});

test('a plugin that can be previewed says how, and only while it is on', () => {
  assert.match(SOURCE, /manifest\.previewHref && \(state\?\.enabled/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --import tsx --test tests/unit/plugin-admin.test.ts`
Expected: FAIL on the three new tests.

- [ ] **Step 3: The copy**

In `src/lib/admin-i18n.ts`, add to the English `plugins` block:

```ts
    changePicture: 'Change picture',
    choosePicture: 'Choose picture',
    preview: 'Preview on the site',
    previewOff: 'Switch it on to preview it on the site.',
    removePicture: 'Remove picture',
```

and to the Thai `plugins` block:

```ts
    changePicture: 'เปลี่ยนรูป',
    choosePicture: 'เลือกรูป',
    preview: 'ดูตัวอย่างบนเว็บ',
    previewOff: 'เปิดใช้ปลั๊กอินก่อนจึงจะดูตัวอย่างบนเว็บได้',
    removePicture: 'เอารูปออก',
```

- [ ] **Step 4: The fields**

In `src/components/admin/PluginManager.tsx`, import `MediaPicker` from `'./MediaPicker'` and
`UiSelect` from `'./UiSelect'`, and `useState` beside `useRef` if not already imported. Above
`PluginSetUp`, add:

```tsx
interface PluginPictureProps {
  copy: AdminCopy;
  hint?: string;
  id: string;
  initial: string;
  label: string;
  locale: 'en' | 'th';
  name: string;
}

/**
 * A picture from the library, sent with the rest of the form as its id. The preview is the
 * library's own stable address for it, so nothing but the id travels.
 */
function PluginPicture({ copy, hint, id, initial, label, locale, name }: PluginPictureProps) {
  const [mediaId, setMediaId] = useState(initial);
  const [picking, setPicking] = useState(false);
  const choose = useRef<HTMLButtonElement>(null);
  return (
    <div className="admin-field" role="group" aria-labelledby={id}>
      <span className="plugin-setup__label" id={id}>{label}</span>
      {mediaId && <img alt="" className="admin-cover-preview plugin-setup__picture" src={`/media/${mediaId}`} />}
      <input name={name} type="hidden" value={mediaId} />
      <div className="admin-cover-actions">
        <button aria-haspopup="dialog" className="admin-button admin-button--secondary" onClick={() => setPicking(true)} ref={choose} type="button">
          {mediaId ? copy.plugins.changePicture : copy.plugins.choosePicture}
        </button>
        {mediaId && <button className="admin-button admin-button--ghost" onClick={() => setMediaId('')} type="button">{copy.plugins.removePicture}</button>}
      </div>
      {hint && <small>{hint}</small>}
      {picking && (
        <MediaPicker
          kind="image"
          onCancel={() => setPicking(false)}
          onSelect={(asset) => {
            setMediaId(asset.id);
            setPicking(false);
          }}
          ownerLocale={locale}
          returnFocus={choose.current}
        />
      )}
    </div>
  );
}
```

In `PluginSetUp`'s field map, before the `setting.kind === 'color'` branch, add two branches:

```tsx
          ) : setting.kind === 'image' ? (
            <PluginPicture
              copy={copy}
              hint={setting.hint?.[locale]}
              id={`${manifest.id}-${setting.key}`}
              initial={state?.values[setting.key] ?? ''}
              key={setting.key}
              label={setting.label[locale]}
              locale={locale}
              name={setting.key}
            />
          ) : setting.kind === 'choice' ? (
            <div className="admin-field" key={setting.key}>
              <label htmlFor={`${manifest.id}-${setting.key}`}>{setting.label[locale]}</label>
              <UiSelect
                ariaLabel={setting.label[locale]}
                className="admin-control"
                defaultValue={state?.values[setting.key] || setting.fallback}
                id={`${manifest.id}-${setting.key}`}
                name={setting.key}
                options={(setting.options ?? []).map((option) => ({ label: option.label[locale], value: option.value }))}
              />
              {setting.hint && <small>{setting.hint[locale]}</small>}
            </div>
```

(The chain is `switch ? (…) : image ? (…) : choice ? (…) : color ? (…) : (text)`.)

In `.admin-form-actions`, after the save button, add:

```tsx
            {manifest.previewHref && (state?.enabled
              ? <a className="admin-button admin-button--secondary" href={manifest.previewHref} rel="noopener" target="_blank">{copy.plugins.preview}</a>
              : <small>{copy.plugins.previewOff}</small>)}
```

In `src/styles/global.css`, after the `.plugin-setup` rules (or at the end of the plugins
section), add:

```css
/* A picture field in a plugin's settings: its name above, the chosen picture, then the buttons. */
.plugin-setup__label { font-size: var(--text-sm); font-weight: 600; }
.plugin-setup__picture { aspect-ratio: 16 / 9; margin-block-start: 0; }
```

- [ ] **Step 5: Run the tests**

Run: `node --import tsx --test tests/unit/plugin-admin.test.ts` — PASS.

- [ ] **Step 6: Look at it**

Write a temporary browser spec (not committed) from the harness of
`tests/e2e/maintenance.spec.ts` (everything above `async function closeSite`, with its own
`stack` and `TOME_CMS_VITE_CACHE_DIR`), which signs in, opens `/admin/plugins`, opens the Popup's
settings, and screenshots the drawer at 1280 and 375 wide — before and after choosing a picture
uploaded through the picker (`sharp` makes one, as `tests/e2e/home-slides.spec.ts` does) — into
the scratchpad. Save once with the plugin off and once on, and screenshot the preview link.
Read every shot; fix what overlaps, clips or scrolls sideways. Delete the temporary spec and
`rm -rf test-results`.

- [ ] **Step 7: Check the guards**

Put back each and watch a test fail, then undo: render `type="text"` instead of `type="hidden"`
for the picture's input; show the preview link whatever `state?.enabled` says.

- [ ] **Step 8: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(plugins): the settings form draws a picture, a choice and a preview

A picture setting is chosen from the library and sent as its id, with a
preview of what was chosen and a way to remove it. A choice is the
admin's own select, offering the manifest's options. A plugin with a
preview address offers it once it is switched on.
```

```bash
git add src/components/admin/PluginManager.tsx src/lib/admin-i18n.ts src/styles/global.css tests/unit/plugin-admin.test.ts
```

---

### Task 5: The core checks the popup it is given

**Files:**
- Modify: `src/server/plugins/public.ts`
- Create: `tests/integration/popup-public.test.ts`

**Interfaces:**
- Consumes: `SitePopup`, `Plugin.sitePopup` (Task 1); the popup plugin (Task 1).
- Produces: `PublicAdditions.popup: PublicPopup | null`, where
  `interface PublicPopup { action: { href: string; label: string }; decline?: string; delaySeconds: number; dismissKey: string; finePrint?: string; heading: string; image: { height: number; src: string; width: number } | null; pluginId: string; text?: string; trigger: 'delay' | 'exit' }`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/popup-public.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

test('the core draws the popup it can check, and only that', async (context) => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_URL, 'postgresql://tomecms_test:foundation-test-only@127.0.0.1:55432/tomecms_test');
  const { db, closeDatabase } = await import('../../src/server/db/client');
  const { migrateToLatest } = await import('../../src/server/db/migrator');
  const { publicAdditions } = await import('../../src/server/plugins/public');
  context.after(closeDatabase);

  await migrateToLatest();
  const ownerId = randomUUID();
  await db.insertInto('user').values({
    id: ownerId, name: 'Owner', email: 'popup-public@example.invalid', emailVerified: true, image: null, role: 'owner',
  }).execute();
  const media = async (values: Record<string, unknown>) => (await db.insertInto('media_items').values({
    owner_id: ownerId, folder_id: null, checksum_sha256: `${'A'.repeat(43)}=`, state: 'ready', delete_error_code: null,
    object_key: `owners/${ownerId}/2026/09/${randomUUID()}`, original_name: 'file', mime_type: 'image/jpeg',
    size_bytes: 400_000, width: 1600, height: 900, alt_text: null, ...values,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const picture = await media({});
  const guide = await media({ mime_type: 'application/pdf', width: null, height: null });

  // Written as the row, not through the store: this is about what the page does with a row,
  // including one edited by hand that the store would have refused.
  const popup = async (settings: Record<string, string>) => {
    await db.insertInto('plugin_settings').values({ enabled: true, id: 'popup', owner_id: ownerId, settings: JSON.stringify(settings) })
      .onConflict((conflict) => conflict.column('id').doUpdateSet({ enabled: true, settings: JSON.stringify(settings) })).execute();
  };
  const origin = 'https://example.com';
  const home = { kind: 'home', locale: 'en' } as const;
  const base = { actionEn: 'Claim my savings', actionHref: '/en/deals', headingEn: 'Hottest deals' };

  await popup({ ...base, image: picture });
  const drawn = (await publicAdditions(ownerId, home, origin)).popup;
  assert.equal(drawn?.heading, 'Hottest deals');
  assert.deepEqual(drawn?.action, { href: '/en/deals', label: 'Claim my savings' });
  assert.deepEqual(drawn?.image, { height: 900, src: `/media/${picture}`, width: 1600 });
  assert.equal(drawn?.pluginId, 'popup');
  assert.equal(drawn?.trigger, 'delay');
  assert.equal(drawn?.delaySeconds, 10);
  assert.deepEqual((await publicAdditions(ownerId, home, origin)).clients.map(({ id }) => id), ['popup'], 'and its browser code is asked for');

  await popup({ ...base, actionHref: 'https://example.com/deals?x=1' });
  assert.equal((await publicAdditions(ownerId, home, origin)).popup?.action.href, '/deals?x=1', 'a same-origin link is a path');
  await popup({ ...base, actionHref: 'https://partner.example/deals' });
  assert.equal((await publicAdditions(ownerId, home, origin)).popup?.action.href, 'https://partner.example/deals');
  for (const href of ['javascript:alert(1)', 'http://partner.example/deals', 'data:text/html,hi']) {
    await popup({ ...base, actionHref: href });
    assert.equal((await publicAdditions(ownerId, home, origin)).popup, null, `${href} draws no popup`);
  }

  for (const image of [guide, randomUUID(), 'lake.jpg']) {
    await popup({ ...base, image });
    const kept = (await publicAdditions(ownerId, home, origin)).popup;
    assert.equal(kept?.heading, 'Hottest deals', 'a picture that cannot be drawn does not take the popup with it');
    assert.equal(kept?.image, null);
  }

  await popup({ ...base, pages: 'home' });
  assert.equal((await publicAdditions(ownerId, { kind: 'post', locale: 'en' }, origin)).popup, null);

  await db.updateTable('plugin_settings').set({ enabled: false }).where('id', '=', 'popup').execute();
  assert.equal((await publicAdditions(ownerId, home, origin)).popup, null, 'off is off');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/test-foundation.mjs tests/integration/popup-public.test.ts`
Expected: FAIL: `drawn` is undefined (`publicAdditions` has no `popup`).

- [ ] **Step 3: Check and resolve it**

In `src/server/plugins/public.ts`, change the contract import to
`import type { PublicPage, SiteNotice, SitePopup } from '../../plugins/contract';` and add:

```ts
import { ACCEPTED_IMAGE_TYPES } from '../../lib/media';
import { db } from '../db/client';
import { isUuid } from '../media/keys';
import { stableMediaPath } from '../media/url';
```

Widen `PublicAdditions`:

```ts
/** A popup as the core will draw it: its link checked, its picture resolved or dropped. */
export interface PublicPopup extends Omit<SitePopup, 'delaySeconds' | 'imageId'> {
  delaySeconds: number;
  image: { height: number; src: string; width: number } | null;
  pluginId: string;
}

export interface PublicAdditions {
  /** Each enabled plugin whose browser code runs here, in the order they are declared. */
  clients: Array<{ dataset: Readonly<Record<string, string>>; id: string }>;
  /** At most one. Two stacked announcement bars is not a feature. */
  notice: (SiteNotice & { pluginId: string }) | null;
  /** At most one, for the same reason. */
  popup: PublicPopup | null;
}
```

Add, after `safeHref`:

```ts
/** The picture, while it is still a ready image of this owner's; otherwise the popup goes without. */
async function popupImage(ownerId: string, id: string): Promise<PublicPopup['image']> {
  if (!isUuid(id)) return null;
  const row = await db.selectFrom('media_items').select(['id', 'width', 'height'])
    .where('owner_id', '=', ownerId).where('id', '=', id.toLowerCase()).where('state', '=', 'ready')
    .where('mime_type', 'in', [...ACCEPTED_IMAGE_TYPES])
    .executeTakeFirst();
  return row?.width && row.height ? { height: row.height, src: stableMediaPath(row.id), width: row.width } : null;
}

const DISMISS_KEY = /^[A-Za-z0-9-]{1,80}$/;

/** A popup the core can draw, or null: a heading, a button and a link it trusts. */
async function checkedPopup(ownerId: string, pluginId: string, popup: SitePopup, origin: string): Promise<PublicPopup | null> {
  const heading = popup.heading.trim();
  const label = popup.action.label.trim();
  const href = safeHref(popup.action.href, origin);
  if (!heading || !label || !href || !DISMISS_KEY.test(popup.dismissKey)) return null;
  const delay = popup.delaySeconds;
  return {
    action: { href, label },
    ...(popup.decline?.trim() ? { decline: popup.decline.trim() } : {}),
    delaySeconds: Number.isInteger(delay) && delay! >= 0 && delay! <= 60 ? delay! : 10,
    dismissKey: popup.dismissKey,
    ...(popup.finePrint?.trim() ? { finePrint: popup.finePrint.trim() } : {}),
    heading,
    image: popup.imageId ? await popupImage(ownerId, popup.imageId) : null,
    pluginId,
    ...(popup.text?.trim() ? { text: popup.text.trim() } : {}),
    trigger: popup.trigger === 'exit' ? 'exit' : 'delay',
  };
}
```

In `publicAdditions`, start with `const additions: PublicAdditions = { clients: [], notice: null, popup: null };`
and, after the notice block, add:

```ts
    const popup = additions.popup ? null : plugin.sitePopup?.(settings, page) ?? null;
    if (popup) additions.popup = await checkedPopup(ownerId, pluginId, popup, origin);
```

- [ ] **Step 4: Run it to see it pass**

Run: `node scripts/test-foundation.mjs tests/integration/popup-public.test.ts` — PASS.
Then `npm run check` (BaseLayout reads `plugins` and must still type-check).

- [ ] **Step 5: Check the guards**

Put back each and watch the test fail, then undo: skip `safeHref` and use `popup.action.href`
as it came; drop the `state = 'ready'` and `mime_type` conditions from `popupImage`; return
null for the whole popup when the picture cannot be resolved.

- [ ] **Step 6: Gates and commit**

Run `npm run test:unit`, then `npm run check`. Message file:

```
feat(plugins): the core checks the popup it is given

At most one popup a page, drawn only with a heading, a button and a link
the core trusts: a path on this site or https. Its picture is resolved
to the library's stable address while it is still a ready image of this
owner's; otherwise the popup is drawn without it.
```

```bash
git add src/server/plugins/public.ts tests/integration/popup-public.test.ts
```

---

### Task 6: Drawing it, opening it, remembering it

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/lib/i18n.ts` (`publicCopy`)
- Modify: `src/styles/global.css`
- Create: `src/plugins/popup/client.ts`
- Modify: `tests/e2e/public-plugins.spec.ts`
- Modify: `CHANGELOG.md` (Unreleased)

**Interfaces:**
- Consumes: `PublicAdditions.popup: PublicPopup | null` (Task 5); `publicClient` of the popup plugin (Task 1).
- Produces: the drawn `<dialog class="site-popup" data-site-popup>` and its behaviour.

- [ ] **Step 1: Write the failing browser tests**

Append to `tests/e2e/public-plugins.spec.ts`:

```ts
const POPUP = {
  actionEn: 'Claim my savings', actionHref: '/en', declineEn: 'No thanks', finePrintEn: 'Exclusions apply.',
  headingEn: 'Hottest deals', textEn: 'Fifteen percent off your first order.',
};

test('a popup opens when it was told, once, and is remembered', async ({ page }) => {
  test.setTimeout(120_000);
  setPlugin('popup', true, { ...POPUP, delay: '5', trigger: 'delay' });
  const popup = page.getByRole('dialog', { name: 'Hottest deals' });

  await page.clock.install();
  await page.goto(`${origin}/en`);
  await expect(page.locator('dialog.site-popup')).toHaveCount(1);
  await expect(popup, 'not at once').toBeHidden();
  await page.clock.runFor(4_000);
  await expect(popup, 'not before its time').toBeHidden();
  await page.clock.runFor(1_500);
  await expect(popup).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest('dialog.site-popup') !== null), 'focus is inside it').toBe(true);
  await expect(popup.getByRole('link', { name: 'Claim my savings' })).toHaveAttribute('href', '/en');
  await expect(popup.getByText('Exclusions apply.')).toBeVisible();

  await popup.getByRole('button', { name: 'No thanks' }).click();
  await expect(popup).toBeHidden();
  await page.reload();
  await page.clock.runFor(20_000);
  await expect(popup, 'declined is remembered').toBeHidden();

  setPlugin('popup', true, { ...POPUP, delay: '5', headingEn: 'New deals', trigger: 'delay' });
  await page.reload();
  await page.clock.runFor(6_000);
  const fresh = page.getByRole('dialog', { name: 'New deals' });
  await expect(fresh, 'a new popup is shown again').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fresh, 'Escape closes it').toBeHidden();

  // Another page, not the same one with a hash: a hash alone does not load the page again.
  await page.goto(`${origin}/en/blog/an-article#popup-preview`);
  await expect(fresh, 'the preview opens it at once, though it was closed').toBeVisible();
  await page.mouse.click(4, 4);
  await expect(fresh, 'a click outside closes it').toBeHidden();
});

test('a popup for a leaving reader, on a mouse and on a phone', async ({ browser, page }) => {
  test.setTimeout(120_000);
  setPlugin('popup', true, { ...POPUP, trigger: 'exit' });
  const popup = page.getByRole('dialog', { name: 'Hottest deals' });
  await page.goto(`${origin}/en`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(popup).toBeHidden();
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientY: -1, relatedTarget: null })));
  await expect(popup, 'the pointer leaving through the top opens it').toBeVisible();

  const phone = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 740 } });
  const small = await phone.newPage();
  await small.goto(`${origin}/en/blog/an-article`);
  const shown = small.getByRole('dialog', { name: 'Hottest deals' });
  await expect(shown).toBeHidden();
  await small.evaluate(() => {
    document.body.append(Object.assign(document.createElement('div'), { style: 'height: 4000px' }));
    window.scrollTo(0, 2_600);
  });
  await expect(shown, 'past half the page opens it on a phone').toBeVisible();
  expect(await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing runs off the side').toBe(true);
  const box = await shown.boundingBox();
  expect(box!.x >= 0 && box!.x + box!.width <= 375, 'the popup fits the phone').toBe(true);
  await phone.close();
});

test('a popup where it was asked for, and none where it is off', async ({ page }) => {
  test.setTimeout(120_000);
  setPlugin('popup', true, { ...POPUP, pages: 'home' });
  await page.goto(`${origin}/en/blog/an-article`);
  await expect(page.locator('dialog.site-popup'), 'home only is not an article').toHaveCount(0);
  await page.goto(`${origin}/en`);
  await expect(page.locator('dialog.site-popup')).toHaveCount(1);

  setPlugin('popup', false, POPUP);
  const asked: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'script') asked.push(request.url()); });
  await page.goto(`${origin}/en`, { waitUntil: 'networkidle' });
  await expect(page.locator('dialog.site-popup'), 'off draws nothing').toHaveCount(0);
  expect(asked.some((url) => url.includes('popup')), 'and ships none of its code').toBe(false);
});
```

Run: `npm run test:e2e -- tests/e2e/public-plugins.spec.ts --project=desktop`
Expected: the three new tests FAIL (no `dialog.site-popup`); the existing ones pass.
`rm -rf test-results`.

- [ ] **Step 2: The words the core says**

In `src/lib/i18n.ts`, `publicCopy`, add to the Thai object:

```ts
      closePopup: 'ปิดหน้าต่างนี้',
      popupDecline: 'ไม่ล่ะ ขอบคุณ',
```

and to the English object:

```ts
      closePopup: 'Close this window',
      popupDecline: 'No thanks',
```

- [ ] **Step 3: Draw it**

In `src/layouts/BaseLayout.astro`, in `<Fragment slot="above">`, after the plugin notice and
before the plugin client spans, add:

```astro
      {plugins.popup && (
        <dialog
          aria-labelledby="site-popup-heading"
          class:list={['site-popup', { 'site-popup--picture': plugins.popup.image }]}
          data-delay={String(plugins.popup.delaySeconds)}
          data-dismiss-key={plugins.popup.dismissKey}
          data-site-popup
          data-trigger={plugins.popup.trigger}
        >
          <form class="site-popup__close" method="dialog">
            <button aria-label={publicText.closePopup} type="submit" value="close"><Icon name="close" /></button>
          </form>
          {plugins.popup.image && (
            <img
              alt=""
              class="site-popup__image"
              decoding="async"
              height={plugins.popup.image.height}
              loading="lazy"
              src={plugins.popup.image.src}
              width={plugins.popup.image.width}
            />
          )}
          <div class="site-popup__body">
            <h2 id="site-popup-heading">{plugins.popup.heading}</h2>
            {plugins.popup.text && <p class="site-popup__text">{plugins.popup.text}</p>}
            <a class="site-popup__action" href={plugins.popup.action.href}>{plugins.popup.action.label}</a>
            <form method="dialog">
              <button class="site-popup__decline" type="submit" value="decline">{plugins.popup.decline ?? publicText.popupDecline}</button>
            </form>
            {plugins.popup.finePrint && <p class="site-popup__fine">{plugins.popup.finePrint}</p>}
          </div>
        </dialog>
      )}
```

Change the `plugins` fallback object to `{ clients: [], notice: null, popup: null }`.

In `src/styles/global.css`, after the `.site-notice` rules, add:

```css
/* The popup a plugin describes and the core draws. <dialog> brings the top layer, the backdrop,
 * the focus trap and Escape; what is here is how it looks. The words are centred under the
 * picture on a phone and beside it on anything wider, and the box scrolls inside itself
 * rather than running off a short screen. */
.site-popup {
  width: min(52rem, calc(100vw - 2 * var(--space-md)));
  max-height: 90dvh;
  padding: 0;
  overflow: auto;
  border: 0;
  border-radius: var(--radius-card);
  background: var(--color-paper);
  color: var(--color-ink);
  box-shadow: 0 1.5rem 4rem color-mix(in oklch, var(--color-ink) 25%, transparent);
}
.site-popup[open] { display: grid; }
.site-popup::backdrop { background: color-mix(in oklch, var(--color-ink) 55%, transparent); }
@media (min-width: 40rem) {
  .site-popup--picture[open] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
.site-popup__close { position: absolute; inset-block-start: var(--space-xs); inset-inline-end: var(--space-xs); z-index: 1; margin: 0; }
.site-popup__close button {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 0;
  border-radius: 50%;
  background: color-mix(in oklch, var(--color-paper) 85%, transparent);
  color: var(--color-ink);
  cursor: pointer;
}
.site-popup__image { display: block; width: 100%; height: 100%; max-height: 12rem; object-fit: cover; }
@media (min-width: 40rem) {
  .site-popup__image { min-height: 22rem; max-height: none; }
}
.site-popup__body { display: grid; gap: var(--space-md); align-content: center; padding: var(--space-xl) var(--space-lg) var(--space-lg); text-align: center; }
.site-popup__body h2 { margin: 0; font-family: var(--font-display); font-size: var(--text-2xl); line-height: 1.2; text-wrap: balance; }
.site-popup__body form { margin: 0; }
.site-popup__text { margin: 0; color: var(--color-muted); }
.site-popup__action {
  display: block;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-accent);
  color: var(--color-accent-ink);
  font-weight: 600;
  text-decoration: none;
}
.site-popup__action:hover { background: var(--color-accent-hover); }
.site-popup__decline {
  padding: var(--space-xs);
  border: 0;
  background: none;
  color: var(--color-ink);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
}
.site-popup__fine { margin: 0; color: var(--color-muted); font-size: var(--text-xs); }
@media (prefers-reduced-motion: no-preference) {
  .site-popup[open] { animation: site-popup-in var(--dur-short) var(--ease-out); }
}
@keyframes site-popup-in {
  from { opacity: 0; transform: translateY(0.5rem) scale(0.98); }
}
```

- [ ] **Step 4: Open it and remember it**

Create `src/plugins/popup/client.ts`:

```ts
/**
 * When the popup opens, and remembering that it closed.
 *
 * The core drew the <dialog>; this only decides the moment. However it closes -- the ✕, the
 * decline, Escape, a click outside, or the button itself -- its `close` event writes the key,
 * so one listener covers every way out. Storage can throw, in a private window or with site
 * data blocked, and a popup that cannot remember comes back on the next visit, never twice
 * on one page.
 */
export default function wirePopup(mount: HTMLElement): void {
  mount.remove();
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-site-popup]');
  const key = dialog?.dataset.dismissKey;
  if (!dialog || !key) return;

  const preview = window.location.hash === '#popup-preview';
  let remembered = false;
  try {
    remembered = Boolean(window.localStorage.getItem(key));
  } catch {
    // Nothing remembered means nothing closed.
  }
  if (remembered && !preview) return;

  dialog.addEventListener('close', () => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // It closes either way; it just comes back next time.
    }
  });
  // Clicking the backdrop means clicking the dialog itself: its children are inside it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelector('.site-popup__action')?.addEventListener('click', () => dialog.close());

  let opened = false;
  const open = () => {
    if (opened) return;
    // Never over another modal, such as the picture viewer: wait until that one closes.
    let other: HTMLDialogElement | null = null;
    try {
      other = document.querySelector<HTMLDialogElement>('dialog:modal');
    } catch {
      other = null;
    }
    if (other && other !== dialog) {
      other.addEventListener('close', open, { once: true });
      return;
    }
    opened = true;
    dialog.showModal();
  };

  if (preview) {
    open();
    return;
  }
  if (dialog.dataset.trigger === 'exit') {
    if (window.matchMedia('(pointer: fine)').matches) {
      const leaving = (event: MouseEvent) => {
        if (event.relatedTarget !== null || event.clientY > 0) return;
        document.removeEventListener('mouseout', leaving);
        open();
      };
      document.addEventListener('mouseout', leaving);
    } else {
      // A phone has no pointer to leave with; reading past half the page stands in for it.
      const reading = () => {
        if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight / 2) return;
        window.removeEventListener('scroll', reading);
        open();
      };
      window.addEventListener('scroll', reading, { passive: true });
    }
    return;
  }
  const seconds = Number(dialog.dataset.delay);
  window.setTimeout(open, (Number.isFinite(seconds) ? seconds : 10) * 1_000);
}
```

- [ ] **Step 5: Run the browser tests**

Run: `npm run test:e2e -- tests/e2e/public-plugins.spec.ts --project=desktop`
Expected: all pass, including the three new ones. `rm -rf test-results`.

If `page.clock.runFor` does not advance the popup's timer because the client module loads
after the clock is installed and still uses the fake `setTimeout`, that is the expected
behaviour; if instead the timer runs on real time, replace the clock with
`await expect(popup).toBeVisible({ timeout: 8_000 })` after checking it is hidden at load, and
say so in the report.

- [ ] **Step 6: Look at it**

Write a temporary browser spec (not committed) from this file's harness that turns the plugin
on with and without a picture (the seeded `media_items` row has no file behind it, so upload a
real one through `putObject` or seed one with `sharp` as `tests/e2e/home-slides.spec.ts` does),
opens `/en#popup-preview`, and screenshots the popup light and dark at 1280 and 375 wide, on
`paper` and on `plain` (`update site_settings set theme_id = 'plain'`). Read every shot; fix what
overlaps, clips or scrolls sideways. Delete the temporary spec and `rm -rf test-results`.

- [ ] **Step 7: The changelog**

In `CHANGELOG.md`, under `## Unreleased` → `### Added`, add:

```markdown
- **Popup**, a plugin: a box over the public site with a picture, a heading, a few words, a button that links to a page or an https address, a way to decline and small print, in Thai and English. It opens after 5, 10 or 20 seconds or as the reader leaves, on every page or the home page only, never over another dialog, and not again once closed until its content changes. Plugins gain a picture setting chosen from the library and a choice setting, and the library will not delete a picture a plugin holds.
```

- [ ] **Step 8: Check the guards**

Put back each and watch a test fail, then undo:
- write the key only in the decline button's click handler instead of on `close` (Escape no
  longer remembers; add `await page.reload(); await page.clock.runFor(20_000); await expect(fresh).toBeHidden();`
  after the Escape step if the suite does not already fail);
- drop the `preview` check from `if (remembered && !preview) return;`;
- make `open` ignore `dialog:modal`, and confirm by hand that the lightbox and the popup
  would stack (the suite has no test for it; say so in the report).

- [ ] **Step 9: Gates and commit**

Run `npm run test:unit`, then `npm run check`, then the browser spec once more alone.
Message file:

```
feat(plugins): the popup is drawn, opened and remembered

The core draws the popup as a <dialog> in the page, its close and
decline buttons working without script and its picture fetched only
when it opens. The plugin's browser code opens it after its delay, as a
mouse leaves through the top, or past half the page on a phone, never
over another dialog, and remembers it once closed. #popup-preview opens
it at once for the owner to look at.
```

```bash
git add src/layouts/BaseLayout.astro src/lib/i18n.ts src/styles/global.css src/plugins/popup/client.ts tests/e2e/public-plugins.spec.ts CHANGELOG.md
```

---

## After the last task

Run the whole desktop browser suite once, alone: `npm run test:e2e -- --project=desktop`. Two
editor tests ("a link opens a new tab…", "a line and a table cell can be aligned…") fail now and
then under load; re-run a failure of either alone before believing it. Then the unit suite and
`npm run check` once more.
