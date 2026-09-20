/**
 * An article's images, full size, in the element the platform already has for this.
 *
 * <dialog> brings the top layer, the backdrop, Escape, the focus trap and the return of
 * focus with it. What is left to write is which image to show and how to close it, which is
 * the whole of this file -- a hand-built overlay would be four times the size and worse at
 * every one of those.
 */
export default function wireLightbox(mount: HTMLElement): void {
  const images = [...document.querySelectorAll<HTMLImageElement>('.post-body img, .page-article img')];
  if (!images.length) {
    mount.remove();
    return;
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  const shown = document.createElement('img');
  shown.className = 'lightbox__image';
  const close = document.createElement('button');
  close.className = 'lightbox__close';
  close.type = 'button';
  close.textContent = mount.dataset.close ?? 'Close';
  dialog.append(shown, close);
  mount.replaceWith(dialog);

  close.addEventListener('click', () => dialog.close());
  // Clicking the backdrop means clicking the dialog itself: its children are inside it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  for (const image of images) {
    image.dataset.lightbox = '';
    image.addEventListener('click', () => {
      shown.src = image.currentSrc || image.src;
      shown.alt = image.alt;
      dialog.showModal();
      close.focus();
    });
  }
}
