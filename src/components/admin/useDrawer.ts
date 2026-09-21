import { useCallback, useEffect, useRef, type RefObject } from 'react';

interface Drawer {
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
 * caller that unmounts the panel gives CSS nothing to animate, so `close` marks the panel
 * as leaving, waits for the exit to finish, and tells the caller afterwards. And the page
 * behind a panel is a place to click to be done with it, which a modal dialog does not
 * give you for free.
 *
 * A reader who asked for less motion has no exit to wait for, and is not made to wait for
 * one: what is counted is the animations actually running, not a duration written here.
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
    // Two of these panels are never unmounted, only closed, so the mark left by the last
    // exit is still on them: opening again without clearing it opens them off-screen.
    delete element.dataset.closing;
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
    element.dataset.closing = '';
    // A frame first, so the attribute has been through style before its animations are
    // counted -- asking in the same tick counts the ones that were already there.
    requestAnimationFrame(() => {
      const leaving = element.getAnimations();
      if (!leaving.length) {
        done();
        return;
      }
      void Promise.all(leaving.map((animation) => animation.finished.catch(() => undefined))).then(done);
    });
  }, [onClose]);

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

  return { close, dialog };
}
