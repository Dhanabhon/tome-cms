import { precheck } from './media-client';
import type { MediaKind } from './media';

/** What a drop event offers, as far as the library reads it. */
interface DroppedItem {
  kind: string;
  getAsFile(): File | null;
  webkitGetAsEntry?(): { isDirectory: boolean } | null;
}

export interface DroppedData {
  files?: ArrayLike<File>;
  items?: ArrayLike<DroppedItem>;
}

/** A drag from the computer carries files; text, a link or a picture dragged within a page does not say so. */
export function carriesFiles(types: Iterable<string> | ArrayLike<string> | null | undefined): boolean {
  return Array.from(types ?? []).includes('Files');
}

/** A browser that cannot tell a folder from a file gives a folder as an empty file with no type. */
const looksLikeFolder = (file: File) => file.size === 0 && !file.type;

/**
 * The files of a drop, and how many folders were left out. A folder is not opened: only what was
 * dropped itself is uploaded. Read during the drop event; the items are empty after it.
 */
export function splitDrop(data: DroppedData): { files: File[]; skipped: number } {
  const files: File[] = [];
  let skipped = 0;
  if (data.items) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.() ?? null;
      const file = item.getAsFile();
      if (entry?.isDirectory || !file || (!entry && looksLikeFolder(file))) skipped += 1;
      else files.push(file);
    }
    return { files, skipped };
  }
  for (const file of Array.from(data.files ?? [])) {
    if (looksLikeFolder(file)) skipped += 1;
    else files.push(file);
  }
  return { files, skipped };
}

/** The folder a drop goes into, by name: the one that is open, or Unsorted when none is. */
export function dropFolderName(folderId: string | null | undefined, folders: ReadonlyArray<{ id: string; name: string }>, unsorted: string): string {
  return folders.find((folder) => folder.id === folderId)?.name ?? unsorted;
}

/** What a picker does with a drop: upload the one file, or say why not. */
export type PickerDrop = { file: File } | { refused: 'several' } | { refused: 'folder' } | { refused: 'file'; error: unknown };

/**
 * A picker hands back one file, so it takes a drop of exactly one, of a kind it accepts: the same
 * check its upload button makes. Several things (a folder counts), a folder alone, or a file it
 * would refuse upload nothing. A drop with nothing in it is not answered at all.
 */
export function pickerDrop({ files, skipped }: { files: File[]; skipped: number }, accept: MediaKind | 'any'): PickerDrop | null {
  if (files.length + skipped > 1) return { refused: 'several' };
  if (skipped) return { refused: 'folder' };
  const [file] = files;
  if (!file) return null;
  const checked = precheck(file, accept);
  return checked.ok ? { file } : { refused: 'file', error: checked.error };
}

/**
 * Whether a drop belongs to something else. A modal dialog leaves only itself to the pointer, so
 * the open dialog at the drop's point (`over`, as the browser hit-tests it) is the topmost one. A
 * library takes the drop when that is the dialog it sits in (`home`: a picker), or there is none
 * and neither is it in one (the library page). A picker on its way out takes nothing more.
 */
export function dropBlocked(over: Pick<Element, 'closest'> | null, home: Element | null): boolean {
  return (over?.closest('dialog[open]') ?? null) !== home || Boolean(home?.hasAttribute('data-closing'));
}
