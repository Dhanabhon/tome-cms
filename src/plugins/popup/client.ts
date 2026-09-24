/**
 * When the popup opens, and remembering that it closed.
 *
 * The core drew the <dialog>; this only decides the moment. However it closes -- the ✕, the
 * decline, Escape, a click outside, or the button itself -- its `close` event writes the key,
 * so one listener covers every way out. Storage can throw, in a private window or with site
 * data blocked, and a popup that cannot remember comes back on the next visit, never twice
 * on one page.
 */
export default function wirePopup(mount: HTMLElement): void {
  mount.remove();
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-site-popup]');
  const key = dialog?.dataset.dismissKey;
  if (!dialog || !key) return;

  const preview = window.location.hash === '#popup-preview';
  let remembered = false;
  try {
    remembered = Boolean(window.localStorage.getItem(key));
  } catch {
    // Nothing remembered means nothing closed.
  }
  if (remembered && !preview) return;

  dialog.addEventListener('close', () => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // It closes either way; it just comes back next time.
    }
  });
  // Clicking the backdrop means clicking the dialog itself: its children are inside it. A drag
  // that starts inside the box and ends on the backdrop clicks the dialog as well, as their
  // nearest shared element, so the press has to have started out there too.
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (event) => {
    pressedOutside = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (pressedOutside && event.target === dialog) dialog.close();
  });
  dialog.querySelector('.site-popup__action')?.addEventListener('click', () => dialog.close());

  let opened = false;
  const open = () => {
    if (opened) return;
    // Never over another modal, such as the picture viewer: wait until that one closes.
    let other: HTMLDialogElement | null = null;
    try {
      other = document.querySelector<HTMLDialogElement>('dialog:modal');
    } catch {
      other = null;
    }
    if (other && other !== dialog) {
      other.addEventListener('close', open, { once: true });
      return;
    }
    opened = true;
    dialog.showModal();
  };

  if (preview) {
    open();
    return;
  }
  if (dialog.dataset.trigger === 'exit') {
    if (window.matchMedia('(pointer: fine)').matches) {
      const leaving = (event: MouseEvent) => {
        if (event.relatedTarget !== null || event.clientY > 0) return;
        document.removeEventListener('mouseout', leaving);
        open();
      };
      document.addEventListener('mouseout', leaving);
    } else {
      // A phone has no pointer to leave with; reading past half the page stands in for it. Half
      // of the distance there is to scroll, so a page under two screens long does not count
      // its first scroll as the reader leaving.
      const reading = () => {
        if (window.scrollY < (document.documentElement.scrollHeight - window.innerHeight) / 2) return;
        window.removeEventListener('scroll', reading);
        open();
      };
      window.addEventListener('scroll', reading, { passive: true });
    }
    return;
  }
  const seconds = Number(dialog.dataset.delay);
  window.setTimeout(open, (Number.isFinite(seconds) ? seconds : 10) * 1_000);
}
