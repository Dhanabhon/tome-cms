/** How the File Manager lays its files out. It is the browser's own to remember, not the account's. */
export type MediaView = 'grid' | 'list';

const KEY = 'tomecms.media.view';

/** Storage can be missing, full or blocked; the library opens as a grid whatever it says. */
export function readMediaView(): MediaView {
  try {
    return localStorage.getItem(KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function writeMediaView(view: MediaView): void {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // The view still changes for now; it just is not remembered.
  }
}
