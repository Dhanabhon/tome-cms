# An Editor Of Our Own, On Tiptap 3

Date: 2026-09-23
Status: Design, approved for planning

The writing surface in the admin is Tiptap, reached through `novel`, a package that wraps it
in React components. This design replaces `novel` with a small layer of our own and moves
Tiptap from 2.27.3 to 3.31.3 in the same pass.

## Why this is being done

The reason this started was the wrong one and is recorded here so nobody repeats it: the
advisory against `@tiptap/core` (GHSA-cp6q-959q-f8rh) is already fixed in the 2.27.3 this
repository pins. `npm audit` reports it anyway because the advisory names only 3.30.4 as
patched. Nothing in this design is a security fix.

What is left is maintenance:

- `novel` has had no release since 1.0.2 on 2025-01-18. Its peer on Tiptap is `^2.11.0`, so
  the editor cannot move while it is in the way.
- It brings eight libraries the admin never loads: `cmdk`, `tippy.js`, `jotai`, `tunnel-rat`,
  `react-markdown`, `react-tweet`, `react-moveable` and `katex`.
- What it gives us is thin. Five surfaces, all of which Tiptap 3 now ships itself or which
  come to about a hundred lines here.
- Every `npm audit` on this repository will keep reporting 42 moderate advisories against
  2.x until the editor leaves that line.

## What was decided before this was written

- **The document does not change.** A post saved before this work and a post saved after it
  hold the same JSON and render the same HTML. Every schema change is out of scope, which is
  what makes the existing tests a real gate rather than a formality.
- **One pass, not two.** Dropping `novel` while staying on Tiptap 2 would mean writing the
  bubble menus against `tippy.js` and then writing them again against Floating UI a week
  later. The work lands in ordered tasks instead.
- **React stays at 18.3.1.** `@tiptap/react@3.31.3` accepts 17, 18 and 19.
- **No new editor features.** Not underline, not collaboration, not a character count, and
  no second look at anything that already works.

## What novel does for us today

Eight files import it. This is everything it provides, and what each becomes:

| What we use now | What it becomes |
| --- | --- |
| `EditorRoot`, `EditorContent`, `useEditor` (its context reader) | `useEditor` and `EditorContent` from `@tiptap/react`, shared through `EditorContext` |
| `EditorBubble`, `EditorBubbleItem` | `BubbleMenu` from `@tiptap/react/menus`, and a plain button |
| `EditorCommand`, `EditorCommandList`, `EditorCommandItem`, `EditorCommandEmpty` (cmdk) | `SlashMenu`, ours, a listbox of about 90 lines |
| `Command`, `createSuggestionItems`, `renderItems`, `handleCommandNavigation` | one extension over `@tiptap/suggestion`, which now mounts and positions the menu itself |
| `UploadImagesPlugin`, `createImageUpload`, `handleImageDrop`, `handleImagePaste` | `editor-image-upload.ts`, ours, a placeholder decoration and two handlers |
| `Placeholder`, `StarterKit`, `TiptapImage`, `TiptapLink`, `JSONContent`, `EditorInstance` | direct imports from `@tiptap/extensions`, `@tiptap/starter-kit`, `@tiptap/extension-image`, `@tiptap/extension-link` and `@tiptap/core` |

## The extensions, and the schema they make

`StarterKit` in 3.x includes four extensions it did not include in 2.x: Link, Underline,
ListKeymap and TrailingNode. Three of them would change what a writer can store:

- `link: false`, because this repository configures its own Link (autolink on, no open on
  click, its own classes and `rel`). Leaving both in place would register the mark twice.
- `underline: false`. The sanitizer allows no `u` tag, so an underline would survive in the
  editor, disappear on the page, and read as a bug.
- `trailingNode: false`. It appends an empty paragraph after any document whose last node is
  not one, so a post that ends in a quote, a table, a code block or a file card would store and
  render a paragraph it never had. It is a real convenience, and adopting it is a decision about
  stored documents, not a side effect of a version bump.
- `listKeymap` stays on. It binds keys and touches no node type, and it fixes the backspace
  behaviour at the start of a list item that we have today.

`Placeholder` comes from `@tiptap/extensions` in 3.x, and it has to be configured with
`includeChildren: true`. That is not a preference: `novel` set it, this repository's
`.configure({ placeholder })` only merged a string over it, and the hint inside an empty
heading or list item exists today because of it. The class names the admin's CSS reads,
`is-editor-empty` and `data-placeholder`, are unchanged in 3.x.

`history` is called `undoRedo` in 3.x and is still part of StarterKit, which is all this
repository needs from it.

The same two lines go into `src/server/content/editor.ts`, which builds a second schema with
`getSchema` to render what was stored. The editor's list and the server's list must keep
describing the same document, and `tests/unit/editor-rendering.test.ts` is what says so.

`@tiptap/extension-table` in 3.x is a kit: it exports `Table`, `TableRow`, `TableHeader` and
`TableCell`, so the three single-node packages leave `package.json`. `Table.configure({
renderWrapper: true })` is unchanged, which is what keeps a wide table scrolling inside its
own box.

## The layer we write

A new directory, `src/components/admin/editor/`, holds what `novel` used to hold. Nothing
else in the admin learns anything new.

- `editor-context.ts`: the `EditorContext` provider and a `useCurrentEditor` re-export, so
  `AlignButtons`, `TableBubble`, `SlashCommands` and `BlockInsertMenu` keep reading the
  editor from context instead of taking it as a prop.
- `SlashMenu.tsx`: the list the `/` key opens.
- `slash-command.ts`: the extension that drives it.
- `editor-image-upload.ts`: an image dropped or pasted into the page.

`DocumentCanvas.tsx` owns the editor instance: `useEditor({ extensions, content, onUpdate })`,
wrapped in `EditorContext.Provider`, with `EditorContent` inside it. The `editorProps` it sets
today survive as they are, minus `handleDOMEvents.keydown`, which existed only so cmdk could
see arrow keys.

**Every component that reads the editor's state needs `useEditorState`.** Tiptap 3 no longer
re-renders React on every transaction, so `editor.isActive('bold')` read during a render is a
value from whenever the component last drew. `FormattingBubble`, `AlignButtons` and
`TableBubble` each select what they show through `useEditorState`. This is the one change in
this design that fails quietly rather than loudly: a button that never lights up looks like a
styling bug, so each of the three keeps an e2e assertion on its pressed state.

## The slash menu

`@tiptap/suggestion` in 3.x mounts and positions the menu itself. `onStart` receives a
`mount(element)` that anchors the element to the cursor, keeps it there through scrolling and
resizing, dismisses it on an outside click, and returns the teardown for `onExit`. There is
no Floating UI wiring to write and no `tippy` instance to keep.

The list is ours, and keeps what the tests and the keyboard already expect:

- `role="listbox"` on the list and `role="option"` on each item, with `aria-selected` on the
  highlighted one. Two e2e tests select an option by role and one asserts that Table is
  absent inside a table, so the roles are a contract, not a detail.
- Up, Down, Enter and Escape are handled in the extension's `onKeyDown`, which returns true
  when it consumed the key. Home and End move to the ends of the list. A pointer hovering an
  item highlights it, which is what makes a mixed keyboard and mouse pass feel right.
- The query filters on the title and on `searchTerms`, the way it filters today, and the
  empty state keeps the same copy.
- The items themselves do not move: `commandItems(copy, inTable)` in `SlashCommands.tsx` is
  the same list, still built per editor because its labels follow the owner's language.

## The bubble menus

`BubbleMenu` from `@tiptap/react/menus` takes the same `shouldShow` predicate, so the rule
that decides which of the two bars appears carries over word for word. What changes is how a
bar is placed:

- `tippyOptions={{ duration: 100 }}` has no successor and is dropped. Floating UI does not
  animate, and nothing depended on the fade.
- `tippyOptions.placement` becomes `options.placement`.
- `getReferenceClientRect: () => tableBox(editor)` becomes
  `getReferencedVirtualElement: () => ({ getBoundingClientRect: () => tableBox(editor) })`.
  This is what keeps the table's bar over the table's top left corner instead of over the
  cursor, and it is the part of this migration most likely to need a second look in a
  browser.
- `appendTo` puts a bar at the end of the document body, which is what the
  `[data-tippy-root]` rule in `global.css` was for.

`EditorBubbleItem` existed to hand `onSelect` the editor instance. Its replacement is a
button with an `onClick` that closes over the editor from context.

## Images dropped and pasted

`editor-image-upload.ts` replaces three of novel's exports with one file:

- a ProseMirror plugin holding a `DecorationSet` of placeholders, added and removed through
  transaction metadata under one plugin key, drawing the chosen file where it will land: the
  same `div.img-placeholder` wrapping an `img` with `rounded-lg opacity-50` that is there
  today, read from a `FileReader` data URL, so the picture appears before the upload ends,
- `imageDropHandler` and `imagePasteHandler`, which take the first image file from the event,
  validate it with `declaredMediaType(file, 'image')` as today, insert a placeholder, upload,
  and replace the placeholder with the image node carrying its `mediaId`,
- and, when the upload fails, the alert `createUploadFn` already shows, in the owner's
  language, through `uploadFailureText`.

`ImageUploader.ts` keeps its shape: `createUploadFn(copy)` still returns the function the
editor props hand to both handlers, so `DocumentCanvas` memoizes exactly what it memoizes now.

## CSS

Three rules in `src/styles/global.css` name tippy and go with it: `[data-tippy-root]`,
`.tippy-box` and `.tippy-content`. What they did, a max width of the viewport less a rem and
a z-index over the admin's chrome, moves onto our own class on the two bars and the slash
menu. The `.block-insert-menu` rule and everything under `prefers-reduced-motion` stay.

## Dependencies

Removed: `novel`, `@tiptap/extension-table-cell`, `@tiptap/extension-table-header`,
`@tiptap/extension-table-row`.

Added: `@tiptap/react`, `@tiptap/suggestion`, `@tiptap/extensions`. All three were already in
the tree under `novel`; this makes them ours. `@floating-ui/dom` arrives as a dependency of
the bubble menu and suggestion packages, so it is not named in `package.json`.

Bumped to 3.31.3: `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-image`,
`@tiptap/extension-link`, `@tiptap/extension-table`, `@tiptap/extension-text-align`.

The admin's JavaScript should get smaller. The number is not a target and is not a gate; it
is reported in the release notes because it is the part of this an owner can feel.

## Verification

Nothing here is finished on the strength of a build.

- `tests/unit/editor-rendering.test.ts` is the schema gate: the HTML the server renders for a
  stored document has to come out byte for byte as it does now. It runs against the new
  extension list before any component is touched.
- `tests/e2e/editor-blocks.spec.ts` covers the writing surface: the slash menu, headings,
  lists, code, quotes, tables, alignment, links, images and file cards. Every one of its
  tests passes unchanged, or the change is wrong.
- `tests/e2e/select-in-dialog.spec.ts` keeps the editor honest inside a dialog, which is
  where a menu mounted on the body can go wrong.
- A pass by hand in a browser at a phone width for the two bars and the slash menu, because
  placement is the one thing no assertion here really reads.
- `npm run test:unit`, `npm run check` and `npm run build` before each commit, as always.
- After it lands, `npm audit --omit=dev` should report no advisory against `@tiptap/core`.

## Not in this design

- React 19.
- Underline, or any other new mark or node.
- The document schema, the sanitizer's allowlist, the public API, and the themes.
- `BlockInsertMenu`'s own positioning, which is ours already and is not going through
  Floating UI in this pass.
- Markdown paste, which novel offered and this repository never turned on.

## Risks

- **The table bar lands in the wrong place.** Floating UI's virtual element is not tippy's
  rect getter, and the two disagree about what a reference is. This is where a browser pass
  earns its keep.
- **A bubble button stops lighting up.** The `useEditorState` change is silent when it is
  wrong. Covered by the pressed-state assertions.
- **The slash menu's keyboard drifts.** cmdk handled the arrows; now we do. The two e2e tests
  that reach an option by role are the floor, not the ceiling.
- **StarterKit 3 brings something else we did not notice.** The extension list is compared
  against the 2.x one node by node and mark by mark, in the first task, before anything else
  is touched.
