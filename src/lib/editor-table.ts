import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';

/**
 * A table, configured once: the editor draws it and the server renders what gets stored, and
 * the two must never disagree about what a table is.
 *
 * Wrapped, so a table wider than a phone scrolls inside its own box instead of widening the
 * page. Not resizable: dragging column widths is not offered, so a table is as wide as its
 * words, and the theme decides the rest.
 */
/** What a new table starts as: room to begin, with a header row to say what the columns are. */
export const NEW_TABLE = { cols: 3, rows: 3, withHeaderRow: true } as const;

export const tableExtensions = [Table.configure({ renderWrapper: true }), TableRow, TableHeader, TableCell];
