/**
 * Closing the band, and remembering that it was closed.
 *
 * The key is the plugin's, derived from the words, so a new message is shown again to a
 * reader who closed the last one. Storage can throw -- a private window, blocked site data --
 * and a band that cannot remember is a band that stays, which is the safe way round.
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
    band.remove();
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // It closes either way; it just comes back next time.
    }
  });
  mount.remove();
}
