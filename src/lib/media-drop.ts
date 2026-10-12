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
