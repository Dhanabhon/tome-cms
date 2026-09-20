/**
 * An article's images, full size, in the element the platform already has for this.
 *
 * <dialog> brings the top layer, the backdrop, Escape, the focus trap and the return of
 * focus with it. What is left to write is which image to show and how to close it, which is
 * the whole of this file -- a hand-built overlay would be four times the size and worse at
 * every one of those.
 */
export default function wireLightbox(mount: HTMLElement): void {
  // Asked for in the markup every theme already writes rather than in one theme's class
  // names: `paper` puts the cover outside its body and `plain` names nothing the same, so a
  // selector built from either one is a selector that finds nothing in the other -- and
  // found nothing at all on a site whose articles carry no image but their cover.
  //
  // An `aside` or a `footer` inside an article is what is beside the article rather than
  // part of it, which is where both themes keep the author's face. Nobody wants that at
  // full size.
  const images = [...document.querySelectorAll<HTMLImageElement>('article img')]
    .filter((image) => !image.closest('aside, footer'));
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

  const open = (image: HTMLImageElement) => {
    shown.src = image.currentSrc || image.src;
    shown.alt = image.alt;
    dialog.showModal();
    close.focus();
  };

  for (const image of images) {
    image.dataset.lightbox = '';
    // A plain image is not focusable, so a click handler on one is a control only a mouse
    // has. It says what it is and answers the two keys a button answers.
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    if (!image.alt) image.setAttribute('aria-label', mount.dataset.open ?? 'Open the image full size');
    image.addEventListener('click', () => open(image));
    image.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open(image);
    });
  }
}
