import { useCallback, useEffect, useRef, type RefObject, type SyntheticEvent } from 'react';

import { closeOverlay } from '../../lib/overlay-motion';

interface Drawer {
  /** The panel's `onCancel`: Escape, played out like any other way of closing it. */
  cancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  /** Asks the panel to leave: it plays its exit, and only then is the caller told. */
  close: (after?: () => void) => void;
  dialog: RefObject<HTMLDialogElement>;
}

/**
 * A panel that opens down the right, and leaves the way it arrived.
 *
 * Four screens draw one of these -- a post's settings, a page's, a plugin's setup, a
 * theme's customize -- and each had written out the same effect: show it modally, put the
 * focus on its close button, hand the focus back on the way out.
 *
 * The two things none of them had are here too. Closing is asked for rather than done: a
 * caller that unmounts the panel gives CSS nothing to animate, so `close` plays the exit
 * through closeOverlay, the way every dialog leaves, and tells the caller afterwards. And
 * the page behind a panel is a place to click to be done with it, which a modal dialog does
 * not give you for free.
 */
export function useDrawer({ focus, onClose, open = true }: {
  focus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  open?: boolean;
}): Drawer {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    focus?.current?.focus();
    return () => {
      element.close();
      opener?.focus();
    };
  }, [focus, open]);

  const close = useCallback((after?: () => void) => {
    const done = after ?? onClose;
    const element = dialog.current;
    if (!element) {
      done();
      return;
    }
    // The exit plays once however often it is asked for, and everyone who asked is told.
    void closeOverlay(element).then(done);
  }, [onClose]);

  const cancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    // A dialog opened over this one sends its own Escape.
    if (event.target !== event.currentTarget) return;
    // Chromium lets a page hold Escape back only once the reader has done something on it.
    // Past that the dialog closes itself, unmarked, and plays its exit from CSS; the caller
    // is told at once.
    if (!event.cancelable) {
      onClose();
      return;
    }
    event.preventDefault();
    close();
  }, [close, onClose]);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    // A dialog's own padding dispatches on the dialog as well, so where the click landed is
    // the question rather than what it landed on.
    const dismiss = (event: MouseEvent) => {
      const box = element.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) close();
    };
    element.addEventListener('click', dismiss);
    return () => element.removeEventListener('click', dismiss);
  }, [close, open]);

  return { cancel, close, dialog };
}
