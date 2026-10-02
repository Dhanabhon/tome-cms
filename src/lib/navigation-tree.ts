import type { NavigationItem, NavigationLocation, NavigationMutationItem, NavigationSubItem } from '../types/cms';

/**
 * The Navigation screen's rules for sub-items, on its flat draft list.
 *
 * The screen draws one list in menu order: a top-level item, then its sub-items, then the next.
 * Every rule here keeps that list one a server would accept: one level only, header only, no group
 * under another item, and a parent's sub-items always right after it. Up and down keep a sub-item
 * among its siblings; a drag, or moving it out, takes it to another parent or the top level.
 */
export interface NavigationDraftItem extends Omit<NavigationMutationItem, 'children'> {
  id: string;
  /** The draft id of the top-level item this sits under; null at the top level. */
  parentId: string | null;
}

type ListedRow = Pick<NavigationItem, 'id' | 'kind' | 'label' | 'page_id' | 'url' | 'new_tab' | 'parent_id'>;

const hasChildren = (items: NavigationDraftItem[], id: string) => items.some((entry) => entry.parentId === id);
/** How many rows a top-level item takes with its sub-items, which always follow it. */
const blockLength = (items: NavigationDraftItem[], index: number) => {
  let end = index + 1;
  while (items[end]?.parentId === items[index].id) end += 1;
  return end - index;
};
const insert = (items: NavigationDraftItem[], at: number, ...entries: NavigationDraftItem[]) => [...items.slice(0, at), ...entries, ...items.slice(at)];
const without = (items: NavigationDraftItem[], at: number, count = 1) => [...items.slice(0, at), ...items.slice(at + count)];

export function canIndent(items: NavigationDraftItem[], index: number, location: NavigationLocation): boolean {
  const item = items[index];
  return location === 'header' && index > 0 && !!item && item.parentId === null && item.kind !== 'group' && !hasChildren(items, item.id);
}

/** The index of the nearest top-level item above, the one an indent puts this item under; -1 for none. */
export function indentParent(items: NavigationDraftItem[], index: number): number {
  let parent = index - 1;
  while (parent >= 0 && items[parent].parentId !== null) parent -= 1;
  return parent;
}

/** The item becomes the last sub-item of the nearest top-level item above it. */
export function indent(items: NavigationDraftItem[], index: number): NavigationDraftItem[] {
  if (!canIndent(items, index, 'header')) return items;
  // Everything between that top-level item and this one is already its sub-items, so nothing moves.
  const parent = indentParent(items, index);
  return items.map((entry, position) => position === index ? { ...entry, parentId: items[parent].id } : entry);
}

export const canOutdent = (items: NavigationDraftItem[], index: number): boolean => !!items[index]?.parentId;

/** The sub-item becomes top-level right after its parent's last sub-item; the ones after it stay put. */
export function outdent(items: NavigationDraftItem[], index: number): NavigationDraftItem[] {
  if (!canOutdent(items, index)) return items;
  const item = items[index];
  const rest = without(items, index);
  const parent = rest.findIndex((entry) => entry.id === item.parentId);
  return insert(rest, parent + blockLength(rest, parent), { ...item, parentId: null });
}

/** The index of the item's previous or next sibling (the same parent, or both top-level), or -1. */
export function sibling(items: NavigationDraftItem[], index: number, direction: -1 | 1): number {
  const parentId = items[index]?.parentId;
  for (let position = index + direction; position >= 0 && position < items.length; position += direction) {
    if (items[position].parentId === parentId) return position;
    // A sub-item's siblings end where its parent's block does.
    if (parentId && items[position].parentId === null) return -1;
  }
  return -1;
}

/**
 * Moves the item at `from` onto the row at `to`, for up, down and a drop.
 * A top-level item carries its sub-items and lands before the block it was moved onto when that
 * is above it, after it when below. A sub-item moves among its siblings only.
 */
export function moveBlock(items: NavigationDraftItem[], from: number, to: number): NavigationDraftItem[] {
  const item = items[from];
  const onto = items[to];
  if (!item || !onto || from === to) return items;
  if (item.parentId) {
    if (onto.parentId !== item.parentId) return items;
    return insert(without(items, from), to, item);
  }
  const target = onto.parentId ? items.findIndex((entry) => entry.id === onto.parentId) : to;
  if (target === from) return items;
  const block = items.slice(from, from + blockLength(items, from));
  const rest = without(items, from, block.length);
  const at = rest.findIndex((entry) => entry.id === items[target].id);
  return insert(rest, target < from ? at : at + blockLength(rest, at), ...block);
}

/** Where a dragged item would land, or why it cannot. "after" a top-level row is after its whole block. */
export type DropAction = { kind: 'into' | 'before' | 'after'; target: number } | { refused: DropRefusal };
export type DropRefusal = 'one-level' | 'self' | 'group';

/** The middle of a top-level row, as a share of its height, means "put under it". */
const INTO_FROM = 0.28;
const INTO_TO = 0.72;

/**
 * What dropping the item at `dragged` onto the row at `target` does, with `fraction` the pointer's
 * height within that row (0 at its top edge, 1 at its bottom). Over a top-level row on the header
 * the middle band puts the item under it, the edges place it before or after; over a sub-item, or
 * anywhere on the footer, the upper half is before and the lower half after. Over its own row, where
 * every drag starts, there is nothing to say yet: null.
 */
export function dropAction(items: NavigationDraftItem[], dragged: number, target: number, fraction: number, location: NavigationLocation): DropAction | null {
  const item = items[dragged];
  const onto = items[target];
  if (!item || !onto || dragged === target) return null;
  if (onto.parentId === item.id) return { refused: 'self' };
  const into = location === 'header' && onto.parentId === null && fraction >= INTO_FROM && fraction <= INTO_TO;
  const edge = onto.parentId === null && location === 'header' ? (fraction < INTO_FROM ? 'before' : 'after') : (fraction < 0.5 ? 'before' : 'after');
  // Under a top-level row or beside a sub-item, the item becomes a sub-item: the rules of indent apply.
  if (into || onto.parentId) {
    if (hasChildren(items, item.id)) return { refused: 'one-level' };
    if (item.kind === 'group') return { refused: 'group' };
  }
  return { kind: into ? 'into' : edge, target };
}

/** The menu after a drop; no drop, a refused one, or one that changes nothing returns `items` itself. */
export function applyDrop(items: NavigationDraftItem[], dragged: number, action: DropAction | null): NavigationDraftItem[] {
  if (!action || 'refused' in action) return items;
  const item = items[dragged];
  const onto = items[action.target];
  const block = items.slice(dragged, dragged + (item.parentId ? 1 : blockLength(items, dragged)));
  const rest = without(items, dragged, block.length);
  const at = rest.findIndex((entry) => entry.id === onto.id);
  const parentId = action.kind === 'into' ? onto.id : onto.parentId;
  // Into a row or after a top-level one lands past its sub-items; beside a sub-item lands next to it.
  const position = action.kind === 'before' ? at : action.kind === 'after' && onto.parentId ? at + 1 : at + blockLength(rest, at);
  const next = insert(rest, position, { ...block[0], parentId }, ...block.slice(1));
  return next.every((entry, index) => entry.id === items[index].id && entry.parentId === items[index].parentId) ? items : next;
}

/** Removes one item; a removed parent's sub-items stay, at the top level where they were. */
export function removeItem(items: NavigationDraftItem[], index: number): NavigationDraftItem[] {
  const id = items[index]?.id;
  return without(items, index).map((entry) => entry.parentId === id ? { ...entry, parentId: null } : entry);
}

/** The indexes of groups with nothing under them, which the server refuses. */
export function emptyGroups(items: NavigationDraftItem[]): number[] {
  return items.flatMap((entry, index) => entry.kind === 'group' && !hasChildren(items, entry.id) ? [index] : []);
}

const mutation = ({ kind, label, pageId, url, newTab }: NavigationDraftItem) => ({ kind, label, pageId, url, newTab });

/** The `items` body of `PUT /api/admin/navigation`; a menu with no sub-items is sent flat, as before. */
export function toMutation(items: NavigationDraftItem[]): NavigationMutationItem[] {
  return items.filter((entry) => entry.parentId === null).map((entry) => {
    // A sub-item is never a group: canIndent refuses one.
    const children = items.filter((child) => child.parentId === entry.id).map((child) => mutation(child) as NavigationSubItem);
    return children.length ? { ...mutation(entry), children } : mutation(entry);
  });
}

/** The listed rows of one menu as the draft list, each top-level row followed by its sub-items. */
export function fromRows(rows: ListedRow[]): NavigationDraftItem[] {
  const draft = (row: ListedRow): NavigationDraftItem => ({
    id: row.id, kind: row.kind, label: row.label, pageId: row.page_id, url: row.url, newTab: row.new_tab, parentId: row.parent_id,
  });
  return rows.filter((row) => row.parent_id === null)
    .flatMap((parent) => [parent, ...rows.filter((row) => row.parent_id === parent.id)].map(draft));
}
