/** The most the database keeps of a file's name. */
const MAX_NAME_LENGTH = 255;

/**
 * A file's new name with the stored file's extension kept: the type of what is stored cannot change
 * by renaming, so another ending is only part of the name. Cut to the limit with the extension intact.
 */
export function keepExtension(newName: string, oldName: string): string {
  const name = newName.trim();
  const stored = /^.+(\.[^.\s/\\]+)$/.exec(oldName.trim())?.[1];
  if (!stored) return name.slice(0, MAX_NAME_LENGTH).trimEnd();
  const typed = name.toLowerCase().endsWith(stored.toLowerCase());
  const extension = typed ? name.slice(-stored.length) : stored;
  const base = typed ? name.slice(0, -stored.length) : name;
  return `${base.slice(0, MAX_NAME_LENGTH - extension.length).trimEnd()}${extension}`;
}
