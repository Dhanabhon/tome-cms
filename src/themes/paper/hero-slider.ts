/**
 * The hero's rotation, and the controls that stop it.
 *
 * The track scrolls and snaps on its own -- that is the browser's, and it is what makes the
 * slider work by swipe, by wheel and by keyboard without any of this. What is here is the
 * part a reader has to be able to refuse: a rotation, the button that stops it, and the two
 * that step it.
 *
 * It never starts for a reader who asked for less motion, and it stops while the pointer or
 * the keyboard is inside the hero -- a slide that moves out from under a reader reaching for
 * it is the whole reason carousels have this reputation.
 */
const EVERY = 6_000;

export default function wireHeroSlider(root: HTMLElement): () => void {
  const track = root.querySelector<HTMLElement>('[data-hero-track]');
  const slides = [...root.querySelectorAll<HTMLElement>('[data-hero-slide]')];
  const toggle = root.querySelector<HTMLButtonElement>('[data-hero-toggle]');
  if (!track || slides.length < 2) return () => {};

  // An owner's slides say how long each stays and whether they turn at all. Covers say
  // neither, and keep six seconds and turning.
  const every = Number(root.dataset.every) * 1_000 || EVERY;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = 0;
  let wanted = root.dataset.turn !== 'off';
  let held = false;

  const at = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const go = (index: number) => track.scrollTo({
    left: track.clientWidth * ((index + slides.length) % slides.length),
    behavior: still.matches ? 'auto' : 'smooth',
  });

  const stop = () => {
    window.clearInterval(timer);
    timer = 0;
  };

  const start = () => {
    stop();
    if (wanted && !held && !still.matches) timer = window.setInterval(() => go(at() + 1), every);
  };

  const say = () => {
    if (!toggle) return;
    const rotating = wanted && !still.matches;
    toggle.setAttribute('aria-label', rotating ? toggle.dataset.stop ?? '' : toggle.dataset.start ?? '');
    toggle.dataset.state = rotating ? 'rotating' : 'still';
  };

  const hold = (next: boolean) => {
    held = next;
    start();
  };

  toggle?.addEventListener('click', () => {
    wanted = !wanted;
    say();
    start();
  });
  root.querySelector('[data-hero-prev]')?.addEventListener('click', () => go(at() - 1));
  root.querySelector('[data-hero-next]')?.addEventListener('click', () => go(at() + 1));
  root.addEventListener('pointerenter', () => hold(true));
  root.addEventListener('pointerleave', () => hold(false));
  root.addEventListener('focusin', () => hold(true));
  root.addEventListener('focusout', () => hold(false));
  still.addEventListener('change', () => {
    say();
    start();
  });

  say();
  start();
  return stop;
}
