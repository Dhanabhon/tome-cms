/**
 * Closing a dialog or a popover after its exit has played, rather than before.
 *
 * An exit written only in CSS needs the browser to keep a closing element in the top layer
 * while it animates, which is what `overlay` does -- and only Chromium has it, so in Safari and
 * Firefox a dialog vanished the instant it was closed. So the closing is asked for first: the
 * element is marked as leaving, the stylesheet (overlays.css) gives the mark the closed values,
 * and the exit plays while the dialog is still open. Only once it is over is the dialog closed.
 *
 * What is waited for is the animations actually running, not a duration written here: a
 * reader who asked for less motion has a shorter exit, and a page with no stylesheet has none
 * and closes at once.
 *
 * One limit: a dialog opened again while its exit is still playing opens with the mark on, so
 * unseen, and the exit then closes it. Nothing a reader does can reach that -- the page behind
 * a leaving modal is inert -- so only a script that calls showModal() mid-exit would.
 */

/** Longer than any exit, so an animation that never reports its end cannot hold a dialog open. */
const FAILSAFE_MS = 1_000;

const leaving = new WeakMap<HTMLElement, Promise<void>>();

/** Plays the element's exit, then closes it: `close()` for a dialog, `hidePopover()` for a popover. */
export function closeOverlay(element: HTMLElement, options: { returnValue?: string } = {}): Promise<void> {
  const running = leaving.get(element);
  if (running) return running;
  const done = playExit(element, options.returnValue).finally(() => leaving.delete(element));
  leaving.set(element, done);
  return done;
}

async function playExit(element: HTMLElement, returnValue: string | undefined) {
  element.dataset.closing = '';
  // Asking for the animations brings style up to date first, so the exit the mark has just
  // started is among them. Only the element's own count, its ::backdrop's among them: what runs
  // inside it -- a hover fading, a spinner -- is not its exit, and must not hold it open.
  const exits = element.getAnimations({ subtree: true })
    .filter((animation) => (animation.effect as KeyframeEffect | null)?.target === element);
  if (exits.length) {
    let failsafe = 0;
    await Promise.race([
      Promise.allSettled(exits.map((animation) => animation.finished)),
      new Promise((resolve) => { failsafe = window.setTimeout(resolve, FAILSAFE_MS); }),
    ]);
    window.clearTimeout(failsafe);
  }
  try {
    if (element instanceof HTMLDialogElement) element.close(returnValue);
    else if (element.matches(':popover-open')) element.hidePopover();
  } finally {
    // Style is brought up to date while the mark is still on, and the mark keeps `display` and
    // `overlay` out of the transition: the element leaves the top layer now. Taken off first, the
    // closed state's transition would hold an invisible element over the page for one more exit.
    // It comes off even if closing threw, or the element would stay unclickable for good.
    void getComputedStyle(element).display;
    delete element.dataset.closing;
  }
}

/**
 * Sends the ways a dialog closes itself through `closeOverlay`: Escape, and a form of method
 * `dialog`, which keeps the value of the button that sent it as the dialog's `returnValue`.
 * A listener for `close` still hears every one of them, only later. Returns the unwiring.
 */
export function animateDismissals(dialog: HTMLDialogElement): () => void {
  const cancel = (event: Event) => {
    // Chromium lets a page hold Escape back only once the reader has done something on it.
    // Past that the dialog closes whatever this does, and its exit plays from CSS alone.
    if (!event.cancelable) return;
    event.preventDefault();
    void closeOverlay(dialog);
  };
  const submit = (event: SubmitEvent) => {
    const form = event.target as HTMLFormElement;
    const submitter = event.submitter as HTMLButtonElement | HTMLInputElement | null;
    const method = submitter?.getAttribute('formmethod') ?? form.getAttribute('method');
    if (event.defaultPrevented || method?.toLowerCase() !== 'dialog' || form.closest('dialog') !== dialog) return;
    event.preventDefault();
    void closeOverlay(dialog, { returnValue: submitter?.hasAttribute('value') ? submitter.value : undefined });
  };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('submit', submit);
  return () => {
    dialog.removeEventListener('cancel', cancel);
    dialog.removeEventListener('submit', submit);
  };
}
