# An Editor Of Our Own, On Tiptap 3: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `novel` with a small layer in this repository and move Tiptap from 2.27.3 to
3.31.3, without changing a single thing about the document a writer stores.

**Architecture:** `DocumentCanvas` owns the editor through `useEditor` from `@tiptap/react` and
shares it through `EditorContext`. Four files under `src/components/admin/editor/` hold what
`novel` held: the context, the slash menu, its extension, and the image upload plugin. The two
bubble bars come from `@tiptap/react/menus`, positioned by Floating UI. The server's second
schema in `src/server/content/editor.ts` moves in step, and the HTML it renders is what proves
the document did not change.

**Tech Stack:** Astro 7 SSR, React 18.3.1 islands, Tiptap 3.31.3 (`@tiptap/core`, `-react`,
`-pm`, `-starter-kit`, `-extensions`, `-suggestion`, `-extension-image`, `-extension-link`,
`-extension-table`, `-extension-text-align`), Floating UI (through Tiptap), zod, sanitize-html,
Playwright, `node --test`.

**Spec:** [docs/specs/2026-09-23-editor-without-novel-design.md](../specs/2026-09-23-editor-without-novel-design.md)

## Global Constraints

- The document schema does not change. `npm run test:unit` covers
  `tests/unit/editor-rendering.test.ts`, which renders stored documents to HTML; it passes
  unchanged after every task. If it fails, the change is wrong, not the test.
- Every Tiptap package is pinned to the exact version `3.31.3`, with no `^`, the way 2.27.3 is
  pinned today.
- React stays at `^18.3.1`. Nothing in this plan upgrades React or `@types/react`.
- No user-visible string is invented. Every label comes from `adminCopy` in
  `src/lib/admin-i18n.ts`, which already holds all of them.
- `StarterKit.configure` carries `link: false` and `underline: false` in both extension lists,
  the editor's and the server's, and both lists keep describing the same document.
- The DOM contracts the tests and the CSS read do not move: `.ProseMirror`, the `editor`
  property Tiptap sets on that element, `role="option"` on a slash item, `is-editor-empty` and
  `data-placeholder` on an empty paragraph, `p.file-card` with its two spans, and `aria-pressed`
  on every bubble button that toggles.
- Commits: write the message to a file, then `git commit -F <file>` in its own command. Stage by
  explicit path, never `git add -A`. No attribution lines of any kind. Never `git stash`, never
  `git checkout --`, never `git reset --hard`, never `git clean`.
- `npm run test:unit` and `npm run check` pass before each commit, except where a task says in
  so many words that `astro check` cannot pass yet.
- Tests use disposable stacks only: `node scripts/test-foundation.mjs <file>` for integration and
  the e2e specs' own compose project. Never touch `tome-cms-postgres-1`, `tome-cms-seaweedfs-1`
  or the dev server on port 4321, which belong to the owner.
- The shell is zsh: quote every glob passed to a command.

---

### Task 1: The packages, and the schema that does not move

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (by `npm install`, never by hand)
- Modify: `src/lib/editor-table.ts:1-4`
- Modify: `src/server/content/editor.ts:35-44`
- Modify: `src/components/admin/Editor.tsx:1`
- Modify: `src/components/admin/PageEditor.tsx:1`
- Test: `tests/unit/editor-rendering.test.ts` (unchanged, and it is the gate)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: Tiptap 3.31.3 in `node_modules`; `tableExtensions` unchanged in name and shape;
  `type JSONContent` imported from `@tiptap/core` rather than from `novel`.

- [ ] **Step 1: Record what the server renders today**

Run this first, on the current tree, and keep the output to compare against:

```bash
node --import tsx --test tests/unit/editor-rendering.test.ts
```

Expected: 8 tests pass. This is the shape the document has to keep.

- [ ] **Step 2: Swap the packages**

```bash
npm uninstall novel @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-table-row
npm install --save-exact @tiptap/core@3.31.3 @tiptap/pm@3.31.3 @tiptap/react@3.31.3 @tiptap/starter-kit@3.31.3 @tiptap/extensions@3.31.3 @tiptap/suggestion@3.31.3 @tiptap/extension-image@3.31.3 @tiptap/extension-link@3.31.3 @tiptap/extension-table@3.31.3 @tiptap/extension-text-align@3.31.3
```

Expected: `npm ls novel` reports it is gone, and `package.json` holds ten `@tiptap/*` entries, all
`3.31.3` with no `^`.

- [ ] **Step 3: One import for the whole table**

`src/lib/editor-table.ts`, first four lines become one. Everything below them stays exactly as it is:

```ts
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
```

- [ ] **Step 4: Turn off what StarterKit 3 added**

In `src/server/content/editor.ts`, the `StarterKit.configure({ ... })` call gains two lines. The
`heading`, `blockquote`, `code` and `codeBlock` options it already has do not change:

```ts
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: { HTMLAttributes: { class: 'border-l-2 border-accent pl-5 italic' } },
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-code p-5 font-mono text-sm text-ondark' } },
    // StarterKit 3 brings both. Link is configured here already, and an underline would be
    // dropped by the sanitizer on its way to the page, so neither belongs in the schema.
    link: false,
    underline: false,
  }),
```

- [ ] **Step 5: The document type comes from Tiptap now**

`src/components/admin/Editor.tsx:1` and `src/components/admin/PageEditor.tsx:1`:

```ts
import { type JSONContent } from '@tiptap/core';
```

- [ ] **Step 6: Prove the document did not change**

```bash
npm run test:unit
```

Expected: every test passes, `tests/unit/editor-rendering.test.ts` included, with no edit to any
test file. A failure here is a schema change and must be fixed in the extension lists, not in the
test.

`npm run check` cannot pass yet: `astro check` still reads the admin components, which still
import `novel`. That is expected until Task 4 and is not a reason to stop.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/editor-table.ts src/server/content/editor.ts src/components/admin/Editor.tsx src/components/admin/PageEditor.tsx
```

Message (write to a file, then `git commit -F`):

```
build(editor): tiptap 3.31.3, with the document unchanged

StarterKit 3 brings Link and Underline. Link is configured on its own here,
and an underline never reaches the page, so both are turned off and the
schema stays what it was. The table's four nodes come from one package now.
```

---

### Task 2: An image dropped or pasted

**Files:**
- Create: `src/components/admin/editor/editor-image-upload.ts`
- Modify: `src/components/admin/ImageUploader.ts`
- Test: `tests/unit/editor-image-upload.test.ts` (new)

**Interfaces:**
- Consumes: Tiptap 3.31.3 from Task 1; `declaredMediaType`, `uploadFailureText`, `uploadImage`
  and `alertUi`, all unchanged.
- Produces:
  - `imageUploadKey: PluginKey<DecorationSet>`
  - `imageUploadPlugin(): Plugin<DecorationSet>`
  - `type UploadFn = (file: File, view: EditorView, pos: number) => void`
  - `createImageUpload({ validate, onUpload }): UploadFn`
  - `handleImageDrop(view, event, moved, upload): boolean`
  - `handleImagePaste(view, event, upload): boolean`
  - `createUploadFn(copy: AdminCopy): UploadFn` stays the export `DocumentCanvas` uses.

- [ ] **Step 1: Write the failing test**

`tests/unit/editor-image-upload.test.ts`. It runs in plain Node with no DOM, which is the point:
the placeholder's element must be built when it is drawn, not when it is added, or this test
throws `document is not defined`.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';

import { imageUploadKey, imageUploadPlugin } from '../../src/components/admin/editor/editor-image-upload';

const stateWithPlugin = () => EditorState.create({
  plugins: [imageUploadPlugin()],
  schema: getSchema([StarterKit.configure({ link: false, underline: false })]),
});

test('the picture waits where it will land, and leaves when the upload answers', () => {
  const id = {};
  const empty = stateWithPlugin();
  const waiting = empty.apply(empty.tr.setMeta(imageUploadKey, { add: { id, pos: 0, src: 'data:image/png;base64,' } }));
  assert.equal(imageUploadKey.getState(waiting)?.find().length, 1, 'one placeholder while it uploads');

  const answered = waiting.apply(waiting.tr.setMeta(imageUploadKey, { remove: { id } }));
  assert.equal(imageUploadKey.getState(answered)?.find().length, 0, 'and none once it has an answer');
});

test('the picture keeps its place as words are written before it', () => {
  const id = {};
  const empty = stateWithPlugin();
  const waiting = empty.apply(empty.tr.setMeta(imageUploadKey, { add: { id, pos: 1, src: 'data:image/png;base64,' } }));
  const before = imageUploadKey.getState(waiting)?.find()[0]?.from ?? -1;

  const typed = waiting.apply(waiting.tr.insertText('four words before it', 1));
  const after = imageUploadKey.getState(typed)?.find()[0]?.from ?? -1;
  assert.equal(after, before + 'four words before it'.length, 'the placeholder moved with the words');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --import tsx --test tests/unit/editor-image-upload.test.ts
```

Expected: it fails to resolve `src/components/admin/editor/editor-image-upload`.

- [ ] **Step 3: Write the plugin and the handlers**

`src/components/admin/editor/editor-image-upload.ts`:

```ts
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export type UploadFn = (file: File, view: EditorView, pos: number) => void;

interface PlaceholderMeta {
  add?: { id: object; pos: number; src: string };
  remove?: { id: object };
}

export const imageUploadKey = new PluginKey<DecorationSet>('imageUpload');

/**
 * The picture stands where it will land, at half opacity, until the upload answers. The element
 * is built when it is drawn rather than when it is added, so the plugin's own state can be read
 * without a document, which is how it is tested.
 */
export const imageUploadPlugin = (): Plugin<DecorationSet> => new Plugin<DecorationSet>({
  key: imageUploadKey,
  props: { decorations: (state) => imageUploadKey.getState(state) },
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const moved = set.map(tr.mapping, tr.doc);
      const meta = tr.getMeta(imageUploadKey) as PlaceholderMeta | undefined;
      if (meta?.add) {
        const { id, pos, src } = meta.add;
        return moved.add(tr.doc, [Decoration.widget(pos + 1, () => placeholder(src), { id })]);
      }
      if (meta?.remove) {
        const { id } = meta.remove;
        return moved.remove(moved.find(undefined, undefined, (spec) => spec.id === id));
      }
      return moved;
    },
  },
});

function placeholder(src: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'img-placeholder';
  const image = document.createElement('img');
  image.className = 'rounded-lg opacity-50';
  image.src = src;
  box.append(image);
  return box;
}

function placeholderAt(view: EditorView, id: object): number | null {
  const found = imageUploadKey.getState(view.state)?.find(undefined, undefined, (spec) => spec.id === id) ?? [];
  return found.length ? found[0]!.from : null;
}

export function createImageUpload({ onUpload, validate }: {
  onUpload: (file: File) => Promise<string>;
  validate: (file: File) => boolean;
}): UploadFn {
  return (file, view, pos) => {
    if (!validate(file)) return;
    const id = {};
    const reader = new FileReader();
    reader.onload = () => {
      const tr = view.state.tr;
      if (!tr.selection.empty) tr.deleteSelection();
      view.dispatch(tr.setMeta(imageUploadKey, { add: { id, pos, src: String(reader.result) } }));
    };
    reader.readAsDataURL(file);

    onUpload(file).then((src) => {
      const at = placeholderAt(view, id);
      // Gone from the document while it uploaded: there is nothing to put the picture in.
      if (at === null) return;
      const image = view.state.schema.nodes.image?.create({ src });
      if (!image) return;
      view.dispatch(view.state.tr.replaceWith(at, at, image).setMeta(imageUploadKey, { remove: { id } }));
    }, () => {
      // The alert is the uploader's; here the placeholder just leaves.
      view.dispatch(view.state.tr.setMeta(imageUploadKey, { remove: { id } }));
    });
  };
}

/** A file dropped onto the page, unless the editor is moving something of its own. */
export function handleImageDrop(view: EditorView, event: DragEvent, moved: boolean, upload: UploadFn): boolean {
  const file = moved ? undefined : event.dataTransfer?.files[0];
  if (!file?.type.startsWith('image/')) return false;
  event.preventDefault();
  upload(file, view, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? -1);
  return true;
}

/** A file pasted into the page, which lands where the cursor is. */
export function handleImagePaste(view: EditorView, event: ClipboardEvent, upload: UploadFn): boolean {
  const file = event.clipboardData?.files[0];
  if (!file?.type.startsWith('image/')) return false;
  event.preventDefault();
  upload(file, view, view.state.selection.from);
  return true;
}
```

- [ ] **Step 4: Run the test again**

```bash
node --import tsx --test tests/unit/editor-image-upload.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Check the guard by putting the bug back**

Temporarily change `Decoration.widget(pos + 1, () => placeholder(src), { id })` to
`Decoration.widget(pos + 1, placeholder(src), { id })`, run the test, and see it fail with
`document is not defined`. Put it back and confirm the test passes again. Do not commit the bug.

- [ ] **Step 6: The uploader keeps its shape**

`src/components/admin/ImageUploader.ts`. Only the import and the call change; `failed`,
`validateFn` and `onUpload` keep their bodies word for word, and the export stays
`createUploadFn(copy)`:

```ts
import { createImageUpload } from './editor/editor-image-upload';
```

The option is called `validate` now rather than `validateFn`:

```ts
  return createImageUpload({
    validate: (file) => {
      try {
        declaredMediaType(file, 'image');
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    onUpload: async (file) => {
      try {
        return await uploadImage(file);
      } catch (error) {
        failed(error);
        throw error;
      }
    },
  });
```

- [ ] **Step 7: Run the whole unit suite and commit**

```bash
npm run test:unit
```

Expected: everything passes, including the two new tests. `npm run check` still cannot pass.

```bash
git add src/components/admin/editor/editor-image-upload.ts src/components/admin/ImageUploader.ts tests/unit/editor-image-upload.test.ts
```

```
feat(editor): an image dropped or pasted, without novel

The placeholder is a decoration built when it is drawn, so what the plugin
does with it can be read in a test with no document at all. Both guards were
checked by putting the bug back.
```

---

### Task 3: The slash menu

**Files:**
- Rename then modify: `src/components/admin/SlashCommands.tsx` to `src/components/admin/editor/slash-items.tsx`
- Create: `src/components/admin/editor/slash-command.ts`
- Create: `src/components/admin/editor/SlashMenu.tsx`

**Interfaces:**
- Consumes: `tableActions(copy)` from `./TableBubble`, `PICK_FILE_EVENT`, `NEW_TABLE`, `Icon`, and
  `AdminCopy`, all unchanged.
- Produces:
  - `slash-items.tsx`: `interface SlashItem { command: (props: { editor: Editor; range: Range }) => void; description: string; icon: ReactNode; searchTerms: string[]; title: string }` and
    `commandItems(copy: AdminCopy, inTable: boolean): SlashItem[]`
  - `slash-command.ts`: `createSlashCommand(copy: AdminCopy): Extension`, the same name
    `DocumentCanvas` imports today
  - `SlashMenu.tsx`: `interface SlashMenuHandle { onKeyDown: (props: SuggestionKeyDownProps) => boolean }`
    and the default export, a `forwardRef<SlashMenuHandle, SlashMenuProps>`

The React component `SlashCommands` disappears. In 2.x the list had to be in the page for cmdk to
filter it, which is why the same items were built twice, once for the extension and once for the
component. The extension owns them now.

- [ ] **Step 1: Move the items, keep them word for word**

```bash
mkdir -p src/components/admin/editor
git mv src/components/admin/SlashCommands.tsx src/components/admin/editor/slash-items.tsx
```

In the moved file: delete the default export (the `SlashCommands` component), delete
`createSlashCommand` (it moves to the extension), delete the `novel` import and the `useMemo`
import. Every item in the array stays exactly as it is, including its copy, its icon, its
`searchTerms` and its `command`. The relative imports gain one `../`, so `../Icon` becomes
`../../Icon`, `../../lib/admin-i18n` becomes `../../../lib/admin-i18n`, and `./TableBubble`
becomes `../TableBubble`. The head of the file becomes:

```tsx
import type { Editor, Range } from '@tiptap/core';
import type { ReactNode } from 'react';

import Icon from '../../Icon';
import type { AdminCopy } from '../../../lib/admin-i18n';
import { PICK_FILE_EVENT } from '../../../lib/editor-attachment';
import { NEW_TABLE } from '../../../lib/editor-table';
import { tableActions } from '../TableBubble';

export interface SlashItem {
  command: (props: { editor: Editor; range: Range }) => void;
  description: string;
  icon: ReactNode;
  searchTerms: string[];
  title: string;
}

export const commandItems = (copy: AdminCopy, inTable: boolean): SlashItem[] => [
```

`createSuggestionItems` was novel's identity function and is dropped with it; the array closes
with `];` and nothing else.

- [ ] **Step 2: Write the menu**

`src/components/admin/editor/SlashMenu.tsx`. The roles are a contract: two e2e tests reach an
option by role, and one asserts Table is absent inside a table.

```tsx
import type { SuggestionKeyDownProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import type { SlashItem } from './slash-items';

export interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface SlashMenuProps {
  command: (item: SlashItem) => void;
  empty: string;
  items: SlashItem[];
  label: string;
}

/**
 * What '/' opens. The keys are handled here rather than by the editor, because the editor would
 * move the cursor with the same arrows.
 */
const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(({ command, empty, items, label }, ref) => {
  const [chosen, setChosen] = useState(0);
  // A new query is a new list, and the first of it is what Enter should take.
  useEffect(() => setChosen(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowUp') {
        setChosen((at) => (at - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setChosen((at) => (at + 1) % items.length);
        return true;
      }
      if (event.key === 'Home') {
        setChosen(0);
        return true;
      }
      if (event.key === 'End') {
        setChosen(items.length - 1);
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[chosen];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }), [chosen, command, items]);

  return (
    <div
      aria-label={label}
      className="editor-menu max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 font-sans"
      role="listbox"
    >
      {items.length === 0 ? <p className="px-3 py-5 text-center text-sm text-muted">{empty}</p> : null}
      {items.map((item, at) => (
        <div
          aria-selected={at === chosen}
          className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left ${at === chosen ? 'bg-soft' : ''}`}
          key={item.title}
          onMouseDown={(event) => {
            // The editor keeps the cursor: a menu that took focus would lose the range.
            event.preventDefault();
            command(item);
          }}
          onMouseEnter={() => setChosen(at)}
          role="option"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-xs font-semibold text-ink">
            {item.icon}
          </span>
          <span>
            <span className="block text-sm font-medium text-ink">{item.title}</span>
            <span className="block text-xs text-muted">{item.description}</span>
          </span>
        </div>
      ))}
    </div>
  );
});

SlashMenu.displayName = 'SlashMenu';

export default SlashMenu;
```

- [ ] **Step 3: Write the extension**

`src/components/admin/editor/slash-command.ts`. `mount` is what 3.x added: it puts the element in
the page, anchors it to the cursor, follows it through scrolling and resizing, and closes it on a
click outside. Escape is the plugin's own, which the browser pass in Task 5 checks.

```ts
import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';

import type { AdminCopy } from '../../../lib/admin-i18n';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';
import { commandItems, type SlashItem } from './slash-items';

/** The menu's labels follow the owner's language, so the extension is built per editor. */
export const createSlashCommand = (copy: AdminCopy) => Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        char: '/',
        command: ({ editor, props, range }) => props.command({ editor, range }),
        editor: this.editor,
        items: ({ editor, query }) => {
          const asked = query.trim().toLowerCase();
          return commandItems(copy, editor.isActive('table')).filter((item) => !asked
            || item.title.toLowerCase().includes(asked)
            || item.searchTerms.some((term) => term.includes(asked)));
        },
        render: () => {
          let menu: ReactRenderer<SlashMenuHandle> | null = null;
          let unmount: (() => void) | undefined;

          return {
            onStart: (props) => {
              menu = new ReactRenderer(SlashMenu, {
                editor: props.editor,
                props: { command: props.command, empty: copy.blocks.noCommands, items: props.items, label: copy.blocks.insertBlock },
              });
              unmount = props.mount(menu.element);
            },
            onUpdate: (props) => {
              menu?.updateProps({ command: props.command, empty: copy.blocks.noCommands, items: props.items, label: copy.blocks.insertBlock });
            },
            onKeyDown: (props) => menu?.ref?.onKeyDown(props) ?? false,
            onExit: () => {
              unmount?.();
              unmount = undefined;
              menu?.destroy();
              menu = null;
            },
          };
        },
      }),
    ];
  },
});
```

`copy.blocks.insertBlock` names the list for a screen reader. It is the label the `+` menu already
uses, in both languages, so no copy is added anywhere for this.

- [ ] **Step 4: Check what can be checked**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "editor/(slash|Slash)" || echo "nothing wrong in the three new files"
```

Expected: the three files report no error of their own. The project as a whole still does not
compile, because `DocumentCanvas` still imports `novel`. That is Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/editor/slash-items.tsx src/components/admin/editor/slash-command.ts src/components/admin/editor/SlashMenu.tsx
```

```
feat(editor): the slash menu is ours, on tiptap's suggestion

The suggestion plugin mounts and follows the menu itself in 3.x, so what is
left to write is the list and its keys. The items are built once now, by the
extension, instead of once for it and once for a component cmdk needed.
```

---

### Task 4: The bars, the canvas, and the last of novel

**Files:**
- Modify: `src/components/admin/DocumentCanvas.tsx`
- Modify: `src/components/admin/TableBubble.tsx:1-3,44-70`
- Modify: `src/components/admin/AlignButtons.tsx`
- Modify: `src/components/admin/BlockInsertMenu.tsx:1`
- Modify: `src/styles/global.css:572-575,847-853`

**Interfaces:**
- Consumes: `createSlashCommand(copy)` from `./editor/slash-command`, `createUploadFn(copy)` from
  `./ImageUploader`, and `handleImageDrop` / `handleImagePaste` from `./editor/editor-image-upload`.
- Produces: no new export. After this task nothing in `src` imports `novel`.

The spec named an `editor-context.ts`. `@tiptap/react` exports both `EditorContext` and
`useCurrentEditor`, so there is nothing to wrap and the file is not created.

- [ ] **Step 1: The canvas owns the editor**

In `src/components/admin/DocumentCanvas.tsx`, the `novel` import block becomes:

```tsx
import { isNodeSelection } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { CellSelection } from '@tiptap/pm/tables';
import { EditorContent, EditorContext, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { type ReactNode, useMemo } from 'react';
```

`useCurrentEditor` joins that `@tiptap/react` import for `FormattingBubble`, and the upload module
is imported beside the other local ones:

```tsx
import { handleImageDrop, handleImagePaste, imageUploadPlugin } from './editor/editor-image-upload';
import { createSlashCommand } from './editor/slash-command';
```

`TiptapImage` becomes `Image` and `TiptapLink` becomes `Link` where they are used. `editorImage`
keeps its `mediaId` attribute and its configure block; its `addProseMirrorPlugins` returns our own
plugin:

```tsx
  addProseMirrorPlugins() {
    return [imageUploadPlugin()];
  },
```

`buildExtensions` keeps every line, with the same two options added to StarterKit as the server
has, and the Placeholder line spelling out what novel used to set:

```tsx
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: { HTMLAttributes: { class: 'border-l-2 border-accent pl-5 italic' } },
    code: { HTMLAttributes: { class: 'rounded bg-soft px-1.5 py-0.5 font-mono text-[0.9em]' } },
    codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-code p-5 font-mono text-sm text-ondark' } },
    link: false,
    underline: false,
  }),
  // includeChildren is what puts the hint inside an empty heading or list item, not only in an
  // empty document. novel set it; now it is said here.
  Placeholder.configure({ includeChildren: true, placeholder: copy.blocks.placeholder }),
```

The component itself:

```tsx
export default function DocumentCanvas({ initialContent, onChange, ownerLocale }: DocumentCanvasProps) {
  const copy = adminCopy(ownerLocale);
  // Rebuilding the extension list would reset the editor, so it is tied to the copy only.
  const extensions = useMemo(() => buildExtensions(copy), [copy]);
  const uploadFn = useMemo(() => createUploadFn(copy), [copy]);
  // The island is client:only, so there is no server render to hold the editor back.
  const editor = useEditor({
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'prose max-w-none prose-headings:font-sans prose-a:text-link prose-img:rounded-lg',
      },
      handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadFn),
      handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
    },
    extensions,
    onUpdate: ({ editor: instance }) => onChange(instance.getJSON()),
  }, [extensions, uploadFn]);

  if (!editor) return null;

  return (
    <EditorContext.Provider value={{ editor }}>
      <EditorContent className="editor-canvas editor-content admin-editor-content" editor={editor} />
      <FormattingBubble copy={copy} />
      <TableBubble copy={copy} />
      <BlockInsertMenu copy={copy} ownerLocale={ownerLocale} />
    </EditorContext.Provider>
  );
}
```

`handleCommandNavigation` and its `handleDOMEvents.keydown` are gone: the slash menu's keys are
the suggestion plugin's now.

- [ ] **Step 2: The formatting bar reads the editor through a selector**

3.x does not re-render React on every transaction, so `editor.isActive('bold')` read while
rendering is whatever it was last time. `FormattingBubble` keeps every action and its copy, and
takes the four flags from a selector:

```tsx
function FormattingBubble({ copy }: { copy: AdminCopy }) {
  const { editor } = useCurrentEditor();
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance?.isActive('bold') ?? false,
      code: instance?.isActive('code') ?? false,
      italic: instance?.isActive('italic') ?? false,
      link: instance?.isActive('link') ?? false,
    }),
  });
  if (!editor || !active) return null;
```

Each action's `active:` reads from that object (`active.bold`, `active.italic`, `active.link`,
`active.code`) and its `run` is unchanged. `EditorBubble` becomes `BubbleMenu`, and each
`EditorBubbleItem` becomes the button it wrapped, with the `onClick` the item's `onSelect` had:

```tsx
  return (
    <BubbleMenu
      className="editor-menu flex overflow-hidden rounded-md border border-line bg-surface p-1 font-sans"
      editor={editor}
      // Less cells chosen together: those bring the table's bar instead.
      shouldShow={({ editor: instance, state: { selection } }) => instance.isEditable && !instance.isActive('image')
        && !selection.empty && !isNodeSelection(selection) && !(selection instanceof CellSelection)}
    >
      {actions.map((action) => (
        <button
          aria-label={action.label}
          aria-pressed={action.active}
          className={`flex h-8 min-w-9 items-center justify-center rounded px-2 text-sm font-semibold hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4 ${action.active ? 'bg-soft text-accent' : 'text-ink'}`}
          key={action.label}
          onClick={() => action.run(editor)}
          type="button"
        >
          {action.text}
        </button>
      ))}
      <span aria-hidden="true" className="mx-1 w-px self-stretch bg-line" />
      <AlignButtons copy={copy} />
    </BubbleMenu>
  );
```

- [ ] **Step 3: The table's bar keeps its corner**

`src/components/admin/TableBubble.tsx`. `tableActions` and `tableBox` do not change. The import
line becomes `import { useCurrentEditor, useEditorState } from '@tiptap/react';` plus
`import { BubbleMenu } from '@tiptap/react/menus';`, and the bar itself:

```tsx
    <BubbleMenu
      className="editor-menu rounded-md border border-line bg-surface p-1 font-sans"
      editor={editor}
      // tippy took a rect; Floating UI takes a thing that has one.
      getReferencedVirtualElement={() => ({ getBoundingClientRect: () => tableBox(editor) })}
      options={{ placement: 'top-start' }}
      pluginKey="tableBubble"
      shouldShow={({ editor: instance, state }) => instance.isEditable && instance.isActive('table')
        && (state.selection.empty || state.selection instanceof CellSelection)}
    >
```

Each `EditorBubbleItem` becomes its button with `onClick={() => void action.run(editor.chain().focus()).run()}`.

- [ ] **Step 4: The alignment buttons**

`src/components/admin/AlignButtons.tsx` keeps its shape. It reads the editor with
`useCurrentEditor`, takes its three flags through `useEditorState`, and returns buttons instead of
`EditorBubbleItem`s:

```tsx
export default function AlignButtons({ copy }: { copy: AdminCopy }) {
  const { editor } = useCurrentEditor();
  const actions = alignActions(copy);
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => actions.map((action) => (instance ? action.active(instance) : false)),
  });
  if (!editor || !active) return null;

  return actions.map((action, at) => (
    <button
      aria-label={action.label}
      aria-pressed={active[at]}
      className={`flex h-8 min-w-9 items-center justify-center rounded px-2 hover:bg-soft [&_.icon]:h-4 [&_.icon]:w-4 ${active[at] ? 'bg-soft text-accent' : 'text-ink'}`}
      key={action.label}
      onClick={() => void action.run(editor.chain().focus()).run()}
      type="button"
    >
      <Icon name={action.icon} />
    </button>
  ));
}
```

`useEditorState` compares with `fast-equals`, so an array of three booleans is compared by value
and the buttons redraw only when one of them turns.

- [ ] **Step 5: The + menu changes one line**

`src/components/admin/BlockInsertMenu.tsx:1` becomes:

```tsx
import { useCurrentEditor } from '@tiptap/react';
```

and the `useEditor()` call at line 21 becomes `useCurrentEditor()`. Its own positioning, its
`cursor` state and its `GAP` are not touched.

One read has to move. At line 146 the items array asks `editor.isActive('table')` while it
renders, which decides whether Table is offered, and in 3.x that answer is as old as the last
draw. It comes from a selector instead:

```tsx
  const inTable = useEditorState({ editor, selector: ({ editor: instance }) => instance?.isActive('table') ?? false });
```

and line 146 becomes `...(inTable ? [] : [`. Offering Table inside a table is what this prevents.
The test at `tests/e2e/editor-blocks.spec.ts:430` asks the same question of the slash menu, which
answers by role; the `+` menu's entries are buttons, so nothing asserts this one and the browser
pass in Task 5 is where it is checked.

- [ ] **Step 6: The CSS that named tippy**

In `src/styles/global.css`, delete the `[data-tippy-root]` rule and the `.tippy-box, .tippy-content`
rules, and put what they did on our own class, next to where the tippy rule was:

```css
/* The bars and the slash menu, which Floating UI places at the end of the body. */
.editor-menu {
  max-width: calc(100vw - 1rem);
  z-index: 50;
}
```

`.block-insert-menu` and everything under `prefers-reduced-motion` stay exactly as they are.

- [ ] **Step 7: Nothing imports novel**

```bash
grep -rn "novel" --include="*.ts" --include="*.tsx" --include="*.astro" --include="*.css" src tests scripts || echo "nothing imports novel"
npm run check
npm run test:unit
npm run build
```

Expected: the grep prints nothing, `astro check` reports 0 errors and 0 warnings, every unit test
passes, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/DocumentCanvas.tsx src/components/admin/TableBubble.tsx src/components/admin/AlignButtons.tsx src/components/admin/BlockInsertMenu.tsx src/styles/global.css
```

```
feat(editor): the bars are tiptap's own, and novel is gone

The canvas holds the editor and shares it through Tiptap's context. 3.x stops
re-rendering React on every transaction, so each bar reads what it shows
through a selector, and the table's bar hands Floating UI a virtual element
where tippy took a rect.
```

---

### Task 5: The editor proved, and the notes

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md` (only the sentence about the audit, if it still needs one)
- Create: `docs/releases/0.9.0.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence, and what an owner reads about it.

- [ ] **Step 1: The whole editor, in a browser**

```bash
npm run test:e2e -- tests/e2e/editor-blocks.spec.ts tests/e2e/select-in-dialog.spec.ts
```

Expected: all 13 tests in `editor-blocks.spec.ts` and all 4 in `select-in-dialog.spec.ts` pass,
with no edit to either file. A failure names the task that caused it; fix it there rather than
here.

- [ ] **Step 2: The rest of the suite**

```bash
npm run test:e2e
```

Expected: the full run is green, with the phone project's Chromium-only tests skipped as they are
by design.

- [ ] **Step 3: The pass no assertion makes**

In a browser, at a phone width and at a desktop width, with the dev server the owner is already
running left alone (start one on another port if needed):

- `/` opens the menu under the cursor, the arrows move through it, Enter takes one, Escape closes
  it, and a click outside closes it.
- The formatting bar appears over chosen words, its buttons light up for bold, italic, a link and
  inline code, and it is whole at the top and the bottom of the page.
- The table's bar sits over the table's top left corner and stays there as the cursor moves from
  cell to cell.
- An image dropped and an image pasted both show the picture at half opacity first, then the
  image itself, and a refused file says why in the owner's language.
- The placeholder hint shows in an empty document and inside an empty heading.
- The `+` menu inside a table offers no Table, and outside one it does.

Write down what was seen, in the report, for each of the five.

- [ ] **Step 4: The audit**

```bash
npm audit --omit=dev
```

Expected: nothing against `@tiptap/core`. Record the number of advisories that remain, whatever
it is.

- [ ] **Step 5: Say what changed, and what did not**

`CHANGELOG.md` gains lines under `## Unreleased`, in the voice of the entries around them:

```markdown
### Changed

- The editor runs on Tiptap 3, and the `novel` package it reached Tiptap through is gone, with
  the eight libraries it brought and never used. What a writer stores is unchanged: a post saved
  before this update opens and renders exactly as it did.
```

`docs/releases/0.9.0.md` follows the shape of `docs/releases/0.8.0.md`: what it is, upgrading (no
migration for this), for theme authors and headless sites (nothing changed for them, and say so),
highlights, and a validation boundary that names the unit suite, the e2e run, the browser pass and
the audit number from Step 4.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/releases/0.9.0.md README.md
```

```
docs: the editor's move to tiptap 3

What a writer stores did not change, which is the part worth saying twice.
```
