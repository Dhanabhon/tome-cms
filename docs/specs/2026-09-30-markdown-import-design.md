# Importing a post from Markdown

Date: 2026-09-30
Status: Design, for the owner's approval before planning

An owner can pick one `.md` file and get one draft post from it: the title, slug and settings from
its frontmatter and the body from its Markdown. The owner then matches the file's pictures to picture
files by hand. There is nothing to install and no new setting.

## What was decided before this was written

The owner decided each of these.

- **The core does it; a plugin does not.** A plugin cannot reach the database or add a route
  (`src/plugins/contract.ts`), and that is by design. An owner also needs no plugin to bring their own
  writing in.
- **One file makes one post.** There is no folder, no `.zip`, no batch, and no pairing of a Thai file
  with an English one. Each of those can come later if an owner asks for it.
- **Pictures are matched by hand.**
  - The owner drops the picture files.
  - The screen matches each file to a picture in the post by its file name.
  - The server never downloads a picture from an address in the file. That would be a way in to
    addresses inside the server's network, and a large download is heavy on a 1 GB server.
- **A skipped picture becomes a line of text.** It becomes a paragraph reading `[รูปที่ขาด: name]`
  (Thai) or `[Missing image: name]` (English), where the picture was. The owner finds it in the editor
  and adds the picture later. The post is a draft, so no reader sees the line.
- **Exporting is left out.** It can come later. The spike found where exporting loses content; see
  the last section.

## What the spike showed

The spike ran on 2026-09-30 in a throwaway worktree of `834ff0e`, which has since been removed. It
used `@tiptap/markdown` 3.31.3, the same version as the rest of Tiptap, with the server's own
extensions.

- `new MarkdownManager({ extensions })` works on the server without an editor or a DOM.
- **Parsed without change:**
  - Thai text;
  - headings 1–3;
  - bold, italic, strikethrough and code;
  - links, and bare URLs;
  - nested lists;
  - quotes;
  - code blocks with a language;
  - GFM tables;
  - rules and hard line breaks.
- The document passes `prepareEditorContent` without change.
- A 49 KB file parses in 86 ms, and the server's check of it takes another 23 ms.
- **Raw HTML stays text.** With no `window` on the server, `<script>` becomes plain text, never an
  element.
- The package adds one dependency, `marked`.

**Six things this design must handle** (the "Parsing" section below says how):

| In the file | What the parser does | What the import does |
|---|---|---|
| `####` to `######` | Makes a level 1 heading, because the schema has levels 1–3 only | Makes it a level 3 heading |
| A picture inside a sentence | Leaves `content: undefined`, which the server's check refuses | Removes the undefined values before the check |
| A footnote `[^1]` | Makes a link to the footnote's text | Removes the link and keeps its text |
| A task list `- [ ]` | Makes an ordinary list | Accepts it, and says so in the report |
| Raw HTML | Keeps it as a paragraph of text such as `<div …>` | Removes it, and says so in the report |
| Pictures on their own lines | Leaves an empty paragraph before and after them | Removes those empty paragraphs |

## The file

A UTF-8 text file up to 1 MB, with or without frontmatter. Frontmatter is YAML between two `---`
lines at the very top, read with `yaml`, which the project already has. Every key is optional.

| Key | Becomes | When it is missing or wrong |
|---|---|---|
| `title` | The title, cut to 200 characters | The first level 1 heading, which is then removed from the body. Without one, the file name without `.md`. |
| `slug` | The slug, normalized by `normalizedContentSlug` | Made from the title, as a new post's is |
| `locale` | `th` or `en` | The site's default language |
| `date` | The planned date of the draft (`publishedAt`); publishing uses it as the date | None. A date that cannot be read is dropped and reported. |
| `categories` | The site's categories whose names match, ignoring case | A name with no match is reported and no category is created. With no match at all, the post gets the default category. At most 20, as a post allows. |
| `excerpt` or `description` | The excerpt | Empty |
| `meta_title`, `meta_description` | The SEO fields, cut to their limits | Empty |
| `cover` or `image` | A picture to match, like the ones in the body | No cover |

`status`, `draft` and `published` are read and ignored. An import is always a draft. The report says
so when the file asked for anything else.

Any other key is ignored and not reported. Other tools' frontmatter carries many keys, and listing
them would bury the report's real warnings.

## The screen

"Import Markdown" sits beside "New post" on the post list, `src/pages/admin/index.astro`. It opens a
sheet with three steps.

1. **Choose a file.** The browser sends its text to `POST /api/admin/posts/import/preview`. That call
   saves nothing, and returns:
   - the title, slug, language and categories the post would get;
   - every picture: where it is (`body` or `cover`), its address as written, its file name, and its
     kind (`local`, `remote` or `refused`);
   - the warnings, in the words the report will use.
2. **Match the pictures.** The sheet lists every picture:
   - a picture from an address, such as `https://…`, is **kept as it is** and marked as coming from
     another site;
   - a picture from the computer, such as `./images/a.png` or `a.png`, **needs a file**;
   - a `data:` picture, or any other address, **cannot be used**. It will be skipped.

   The owner drops files, or a whole folder's worth, onto the sheet. Each file is matched to every
   picture with the same file name, ignoring case; that includes a picture from an address, whose
   file then replaces the address. A picture no file matched can be given one by hand, or skipped.
   Every picture from the computer has to be matched or skipped before the import can go on.
3. **Import.** The matched files upload one by one through `uploadImage` in `src/lib/media-client.ts`,
   the same upload the File Manager uses. The browser then sends the text again, with
   `{ address → mediaId }` for each match, to `POST /api/admin/posts/import`. The server parses the
   file again; it is fast enough that nothing needs keeping between the two calls. It then:
   - puts each matched picture at `/media/<id>`;
   - replaces each skipped one with the missing-image line;
   - creates the draft with `createPost`.

   The sheet closes on the new draft's editor, with the report above it.

A cancel after the upload leaves the uploaded pictures in the library, where they can be deleted.
The sheet says so beside the cancel button once anything has uploaded.

**The report** is a short list, only of what happened. For example:

- "3 pictures are still loaded from other sites."
- "2 pictures were skipped; search the post for "Missing image"."
- "The category "Notes" does not exist."
- "HTML in the file was removed (2 places)."
- "Checkboxes in a task list became an ordinary list."

It shows once, above the editor. It is not stored.

## The server

- **`src/server/content/markdown-import.ts`** (new): `parseMarkdownPost(text, fileName)`. It returns
  the frontmatter fields, the document, the pictures and the warnings. It uses no database, so unit
  tests reach every row of the table above.
- **`src/server/content/editor.ts`**: exports its `extensions` array, so the import parses with
  exactly the schema the server renders with. Nothing else changes.
- **`src/pages/api/admin/posts/import/preview.ts`** and **`import/index.ts`**: the two routes.
  - Like every admin write, they require the installed owner and the same origin.
  - They take JSON `{ fileName, text, pictures? }`.
  - They refuse text over 1 MB with 413.
  - Every `mediaId` in `pictures` has to be a ready picture of this owner. `createPost` already checks
    that through `assertContentMedia`.
- **`createPost`** chooses a new group's language from the site default only. It gains an optional
  `locale` for a post with no `sourcePostId`, so an English file on a site whose default is Thai
  becomes an English post. The editor's own "New post" does not send one, and so behaves as before.
- **The dependency:** `@tiptap/markdown` pinned to the Tiptap version, as the other `@tiptap/*`
  packages are. `npm run check:inventory` then lists `marked` as well.

## Tests

- **Unit (`markdown-import`):**
  - every row of the spike table;
  - the frontmatter fallbacks;
  - Thai text;
  - a picture inside a sentence;
  - a file over 1 MB;
  - a file with no frontmatter;
  - frontmatter that is not valid YAML, which is reported and the body still imported.
- **Integration:**
  - an import creates a draft in the file's language with matched categories;
  - a picture from another owner's library is refused;
  - a `date` becomes the planned date.
- **e2e:** one flow at 390 px and at 1440 px: choose a file, drop two of three pictures, skip the
  third, import, and see the draft with two pictures, the missing-image line and the report.

## Left for later

- **Exporting.** The spike found what it would lose:
  - text colour and alignment are dropped without a word;
  - underline becomes `++text++`, which other tools do not read;
  - a video disappears whole;
  - `/media/…` would need the site's full address.

  An export needs its own rules for each of these.
- Several files at once, a `.zip` with its pictures, and pairing a Thai file with an English one.
- Letting the server fetch a picture from an address, which needs guards against the server's own
  network first.
- Pages. The same code serves them once posts are proven.
