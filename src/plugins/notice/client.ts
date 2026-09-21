/**
 * Closing the band, and remembering that it was closed.
 *
 * The key is the plugin's, derived from the words, so a new message is shown again to a
 * reader who closed the last one. Storage can throw -- a private window, blocked site data --
 * and a band that cannot remember is a band that stays, which is the safe way round.
 *
 * This file only exists on a page whose band can be closed at all: a band the owner keeps
 * up has no close control and is not given a script.
 */
export default function wireNotice(mount: HTMLElement): void {
  const band = document.querySelector<HTMLElement>('[data-site-notice]');
  const close = band?.querySelector<HTMLButtonElement>('[data-notice-close]');
  const key = band?.dataset.dismissKey;
  if (!band || !close || !key) return;

  try {
    if (window.localStorage.getItem(key)) {
      band.remove();
      return;
    }
  } catch {
    // Nothing remembered means nothing closed.
  }
  close.addEventListener('click', () => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // It closes either way; it just comes back next time.
    }
    // The height the page has to close up by, measured now rather than guessed in CSS.
    band.style.setProperty('--notice-height', `${band.getBoundingClientRect().height}px`);
    band.dataset.closing = '';
    // A frame, so the attribute has reached style before the running animations are
    // counted. None running -- a reader who asked for less motion -- means gone at once.
    requestAnimationFrame(() => {
      const leaving = band.getAnimations();
      if (!leaving.length) {
        band.remove();
        return;
      }
      void Promise.all(leaving.map((animation) => animation.finished.catch(() => undefined)))
        .then(() => band.remove());
    });
  }, { once: true });
  mount.remove();
}
