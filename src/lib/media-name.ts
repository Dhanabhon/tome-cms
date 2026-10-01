/** The most the database keeps of a file's name, counted in characters. */
const MAX_NAME_LENGTH = 255;

/** A cut at `limit` characters (code points, as the database counts them), so a pair is never split. */
function cut(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('');
}

/**
 * A file's new name with the stored file's extension kept: the type of what is stored cannot change
 * by renaming, so another ending is only part of the name. Cut to the limit with the extension intact.
 */
export function keepExtension(newName: string, oldName: string): string {
  const name = newName.trim();
  // A stored name that is only an ending, such as ".webp", has that ending.
  const stored = /(\.[^.\s/\\]+)$/.exec(oldName.trim())?.[1];
  if (!stored) return cut(name, MAX_NAME_LENGTH).trimEnd();
  // An ending typed after something counts; the name ".webp" on its own is a name, and takes the ending again.
  const typed = name.length > stored.length && name.toLowerCase().endsWith(stored.toLowerCase());
  const extension = typed ? name.slice(-stored.length) : stored;
  const base = typed ? name.slice(0, -stored.length) : name;
  return `${cut(base, MAX_NAME_LENGTH - Array.from(extension).length).replace(/[\s.]+$/, '')}${extension}`;
}
