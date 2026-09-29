/**
 * What a save button says. The form owns three facts -- a request is in flight, the fields differ
 * from what was saved, a save has succeeded since the screen opened -- and the button reads them.
 * A failed save clears `saving` and never sets `savedOnce`, so it lands on "dirty" again.
 */
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

export function saveButtonState({ saving, dirty, savedOnce }: { saving: boolean; dirty: boolean; savedOnce: boolean }): SaveState {
  if (saving) return 'saving';
  if (dirty) return 'dirty';
  return savedOnce ? 'saved' : 'idle';
}
