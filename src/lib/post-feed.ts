/**
 * The homepage feed. The server renders the first page of cards; the rest arrive a row at a
 * time as the reader nears the end of the grid.
 *
 * A page is six cards -- two rows at three across, three at two, six at one -- so a page ends
 * on a full row at any width. The next page is the homepage itself at the next cursor, the
 * same link a reader without JavaScript follows: its cards are parsed out of that response,
 * held hidden at the end of the grid, and shown one row at a time.
 */

/** Cards to show to bring the grid to the end of a row -- a whole row when it is level. */
export function cardsToRowEnd(shown: number, columns: number): number {
  const across = Math.max(1, Math.trunc(columns));
  return across - (shown % across);
}

export default function wirePostFeed(grid: HTMLElement, more: HTMLElement): void {
  const link = more.querySelector<HTMLAnchorElement>('[data-post-next]');
  const status = more.querySelector<HTMLElement>('[data-post-status]');
  const retry = more.querySelector<HTMLButtonElement>('[data-post-retry]');
  if (!link || !status || !retry) return;

  let next: URL | null = new URL(link.href);
  let busy = false;
  more.dataset.state = 'idle';

  const held = () => [...grid.querySelectorAll<HTMLElement>(':scope > .post-card[hidden]')];

  const load = async (url: URL) => {
    const response = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`The next page of posts answered ${response.status}.`);
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    for (const card of page.querySelectorAll<HTMLElement>('[data-post-grid] > .post-card')) {
      card.hidden = true;
      grid.append(document.adoptNode(card));
    }
    const href = page.querySelector('[data-post-next]')?.getAttribute('href');
    next = href ? new URL(href, url) : null;
  };

  const showRow = () => {
    const shown = grid.querySelectorAll(':scope > .post-card:not([hidden])').length;
    const across = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    for (const card of held().slice(0, cardsToRowEnd(shown, across))) {
      card.hidden = false;
      card.dataset.revealed = '';
    }
  };

  const observer = new IntersectionObserver(async ([entry]) => {
    if (!entry?.isIntersecting || busy) return;
    busy = true;
    try {
      if (!held().length && next) {
        more.dataset.state = 'loading';
        await load(next);
      }
      showRow();
    } catch (error) {
      console.error('The next page of posts could not be loaded:', error);
      observer.unobserve(more);
      more.dataset.state = 'error';
      status.textContent = more.dataset.failed ?? '';
      retry.hidden = false;
      return;
    } finally {
      busy = false;
    }
    more.dataset.state = 'idle';
    if (!held().length && !next) {
      observer.disconnect();
      more.remove();
      return;
    }
    // The new row can leave the end of the grid still in view -- a tall window, a fast
    // scroll -- and an observer reports only changes, so ask again.
    observer.unobserve(more);
    observer.observe(more);
  }, { rootMargin: '0px 0px 25% 0px' });

  retry.addEventListener('click', () => {
    retry.hidden = true;
    status.textContent = '';
    more.dataset.state = 'idle';
    observer.observe(more);
  });

  observer.observe(more);
}
