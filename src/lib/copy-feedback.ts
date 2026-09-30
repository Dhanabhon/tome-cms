/** How long "Copied" stays on a button before it says "Copy" again. */
export const COPIED_MS = 2000;

/** `copied` is set on when something is copied and off again `COPIED_MS` later; copying again starts the wait over. */
export function copiedFlag(set: (copied: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    flash() {
      clearTimeout(timer);
      set(true);
      timer = setTimeout(() => set(false), COPIED_MS);
    },
    /** The file changed, or the dialog went: the old copy is not this one's. */
    cancel() {
      clearTimeout(timer);
      set(false);
    },
  };
}
