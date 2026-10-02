# Sub-menus in the header

Date: 2026-10-02
Status: Design. The owner approved both parts on 2026-10-02. The decisions are:
- one level;
- header only;
- a parent may be a link or a label-only group;
- shipped as 1.10.0, separate from the 1.9.1 editor fixes.

Supersedes the line "Menus are flat. Nested items and dropdowns are deferred." in
`docs/specs/2026-09-07-pages-navigation-design.md`.

## What the owner gets

- **On the Navigation screen,** a header item can sit under another one.
- **On the site,** that parent opens a sub-menu:
  - on desktop, as a small panel under it;
  - on a phone, as an indented list inside the existing Menu.
- **A parent can be either:**
  - a link with its own ▾ button; or
  - a **group**, a label with no link that only opens its sub-menu.

## Rules

- **One level.** A sub-item cannot have sub-items of its own.
- **Header only.** The footer stays flat.
- **Groups:**
  - a group must have at least one sub-item when saved;
  - a group is header-only, since a group without a sub-menu has nothing to do.
- **The limit is unchanged.** At most 50 items in one menu (one location in one language), sub-items
  included.
- **The duplicate check spans the whole menu.** A target (Home, a page, a custom URL) may appear only
  once, at either level.

## Data

Migration `029_navigation_parent`:

- **`navigation_items.parent_id uuid null`**
  - It references `navigation_items(id)` on delete cascade.
  - A composite foreign key keeps the parent in the same owner, locale and location.
- **`kind` gains `'group'`.**
  - The target check becomes: a group has `page_id is null and url is null`.
  - `new_tab` stays false for a group, as the existing check already requires for anything but
    custom.
- **Checks in the database:**
  - `parent_id is null or location = 'header'`;
  - `kind <> 'group' or location = 'header'`.
- **A trigger refuses a parent that itself has a parent.** That rule is the one level. It cannot be
  a plain check, because it reads another row.
- **"A group must have sub-items" is checked when the menu is saved,** not by the database. Saving
  replaces the whole menu in one transaction, as it does today.
- **`position` stays one running order across the menu:** a parent, then its sub-items, then the
  next parent. The existing `unique (owner_id, locale, location, position)` stays.
- **No data moves.** Every existing item keeps `parent_id = null`.

## Saving (`PUT /api/navigation`)

The body becomes:

```
items: [{ kind, label, pageId, url, newTab, children?: [{ kind, label, pageId, url, newTab }] }]
```

- **`children` is allowed only:** on a header item; on a top-level item; and when every child is not
  a group.
- **A group needs `children` with at least one item.**
- **Each target appears once across all levels,** checked by the existing duplicate rule over the
  flattened list.
- **The server writes the rows in document order,** parents before their children, setting
  `parent_id` from the parent row it just inserted.
- **On reading,** `listNavigation` returns `parent_id`, and the admin rebuilds the tree from it.

## Admin (Navigation screen)

- **Indenting** (Header tab only). Each item except the first gets:
  - **Move under the item above** (indent);
  - **Move out** (outdent), shown on a sub-item.

  Rules for indenting:
  - indenting makes the item the last sub-item of the nearest top-level item above it, so indenting
    under a sub-item joins that sub-item's parent;
  - an item that has sub-items cannot be indented, since there is only one level.
- **Display.** A sub-item is drawn indented with a thin rule on its inline-start side.
- **Moving.** Moving a parent up, down or by dragging moves its sub-items with it. A sub-item moves
  only among its siblings, and leaves its parent only through Move out.
- **Adding.**
  - The add dialog gains **Group (no link)**, shown on the Header tab only.
  - A new item goes at the end, at the top level.
- **Groups.** A group with no sub-items shows an inline note and blocks saving, in the existing
  validation style: "A group needs at least one item under it".
- **Copy.** Every new string is in `en` and `th`, in natural Thai.

## The site

The theme contract adds to `PublicNavigationItem`:
- `children: PublicNavigationItem[]`, empty for a plain item;
- `kind: 'group'`, with `href: null`.

`getPublicNavigation` builds the tree:
- **A sub-item whose page is not live is dropped,** as a flat item is today.
- **A parent whose page is not live but which still has live sub-items is shown as a group,** a
  label with no link.
- **A group or such a parent with no live sub-items left is dropped.**
- **Deleting the page of a parent that holds sub-items turns the parent into a group,** keeping its
  label and position, and keeps the sub-items. A menu item with no sub-items goes with its page.
- **The theme works out the current section** from the request path, with `isCurrentSection`, so the
  cached menu does not depend on the page being viewed.

### Desktop (Paper and Plain)

- **Markup.**
  - A parent's sub-menu is a `<details>` whose `<summary>` is:
    - for a link parent, a ▾ button beside the link, labelled "Show the {label} menu" (th: "แสดงเมนู
      {label}");
    - for a group, the label itself.
  - Every sub-menu `<details>` in the header shares one `name`, so the browser keeps only one open.
  - This works with no script.
- **A small script** (one file, loaded with the header, about 20 lines) adds:
  - Escape closes the open sub-menu and returns focus to its summary;
  - a click outside closes it;
  - focus leaving it closes it;
  - a panel that would pass the window's inline-end edge is anchored to its parent's inline-end
    instead.
- **Click to open, not hover.** Hover opens by accident and does not exist on touch or keyboard.
- **The current section.** A parent for which `isCurrentSection` is true gets `aria-current="true"` and the same
  look as a current item.
- **Motion.** The panel fades in and drops a few pixels, animated with opacity and transform only.
  It is instant under `prefers-reduced-motion`.
- **Style.** Theme tokens only. The panel is a surface with a border and a shadow from the theme, at
  least as wide as its parent, and its items stack.

### Mobile (inside the existing Menu `<details>`)

- **Sub-items** are listed under their parent, indented and always shown, so there is no second tap.
- **A link parent** stays a link. A group shows as a small label above its sub-items.
- **No horizontal scroll at 390 px.**

## Public API (`/api/v1/content/navigation`)

- **Each item** in `header` and `footer` gains `children` (always present, possibly empty).
- **A group** has `kind: "group"` and `href: null`.
- **Compatibility.** A reader that ignores `children` keeps working until the owner creates a group
  or a sub-item. It then sees only the top level, and a `null` href for groups.
- **Docs.** The OpenAPI schema, the API page and the 1.10.0 notes say so.

## Docs

- **`admin/pages-and-menus.md`, en and th:** sub-menus, groups, indent and outdent, header only.
- **`extending/themes.md`, en and th:** the new fields, with a short rendering example.
- **The API reference,** through the OpenAPI.

## Tests

- **Unit:**
  - the save schema: one level; header only; a group needs children; no group as a child; the
    duplicate check across levels; the 50 cap counting children;
  - the public tree builder: a dropped sub-item; a parent shown as a group when its page is gone; an
    empty parent dropped; `isCurrentSection`;
  - the API serializer.
- **Integration:**
  - the migration up and down;
  - the database checks (no grandchild, no parent in the footer, no group in the footer);
  - saving and listing a menu with sub-items, in one transaction, rolled back on any refusal;
  - a parent deleted with its page, which becomes a group and keeps its sub-items.
- **Browser:**
  - **admin:** indent, outdent, move a parent with its children, add a group, the empty-group block,
    then save and reload;
  - **desktop site, Paper and Plain:** open by click; Escape returns focus; a click outside closes;
    only one open; the edge flip; keyboard only;
  - **mobile site:** the indented list; no overflow at 390 px;
  - screenshots at 390 and 1440, light and dark.

## Release

- 1.10.0, with migration `029_navigation_parent`, so the updater takes a full backup.
- The updating table in the docs gets a new row.
