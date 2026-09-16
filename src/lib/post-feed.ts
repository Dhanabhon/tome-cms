/**
 * The homepage feed. The server renders the first page of cards; the rest arrive a row at a
 * time as the reader nears the end of the grid, and the category pills swap the list in place.
 *
 * A page is six cards -- two rows at three across, three at two, six at one -- so a page ends
 * on a full row at any width. The next page is the homepage itself at the next cursor, the
 * same link a reader without JavaScript follows: its cards are parsed out of that response,
 * held hidden at the end of the grid, and shown one row at a time. A category works the same
 * way: its pill links to the homepage filtered by it, and the list is taken from that page.
 */

/** Cards to show to bring the grid to the end of a row -- a whole row when it is level. */
export function cardsToRowEnd(shown: number, columns: number): number {
  const across = Math.max(1, Math.trunc(columns));
  return across - (shown % across);
}

/** The category a homepage URL filters by, in the case-blind form the server matches it in. */
export function categoryOf(url: URL): string {
  return (url.searchParams.get('category') ?? '').trim().toLocaleLowerCase();
}

async function fetchPage(url: URL, signal?: AbortSignal): Promise<Document> {
  const response = await fetch(url, { headers: { Accept: 'text/html' }, signal });
  if (!response.ok) throw new Error(`${url.pathname}${url.search} answered ${response.status}.`);
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

/** Shows the grid's cards a row at a time as its end comes near. Returns what stops it. */
function wireRows(grid: HTMLElement, more: HTMLElement): () => void {
  const link = more.querySelector<HTMLAnchorElement>('[data-post-next]');
  const status = more.querySelector<HTMLElement>('[data-post-status]');
  const retry = more.querySelector<HTMLButtonElement>('[data-post-retry]');
  if (!link || !status || !retry) return () => {};

  let next: URL | null = new URL(link.href);
  let busy = false;
  let stopped = false;
  more.dataset.state = 'idle';

  const held = () => [...grid.querySelectorAll<HTMLElement>(':scope > .post-card[hidden]')];

  const load = async (url: URL) => {
    const page = await fetchPage(url);
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
    if (!entry?.isIntersecting || busy || stopped) return;
    busy = true;
    try {
      if (!held().length && next) {
        more.dataset.state = 'loading';
        await load(next);
        // A category was chosen while the page loaded: this list is already gone.
        if (stopped) return;
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
  return () => {
    stopped = true;
    observer.disconnect();
  };
}

function startRows(feed: HTMLElement): () => void {
  const grid = feed.querySelector<HTMLElement>('[data-post-grid]');
  const more = feed.querySelector<HTMLElement>('[data-post-more]');
  return grid && more ? wireRows(grid, more) : () => {};
}

/**
 * Swaps the list for the chosen category without leaving the page. The pill keeps its link:
 * a click with a modifier still opens it, the address follows each choice so it can be shared
 * and Back returns to the previous one, and a list that cannot be fetched falls back to
 * following the link.
 */
function wireFilter(nav: HTMLElement, first: HTMLElement, stopFirst: () => void): void {
  const status = nav.querySelector<HTMLElement>('[data-post-filter-status]');
  const key = (url: URL) => url.pathname + url.search;
  let feed = first;
  let stopRows = stopFirst;
  let shown = key(new URL(location.href));
  let pending: AbortController | null = null;

  /** Marks the pill for a category current and returns its label. */
  const markCurrent = (category: string) => {
    let label = '';
    for (const link of nav.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (categoryOf(new URL(link.href)) === category) {
        link.setAttribute('aria-current', 'page');
        label = link.textContent?.trim() ?? '';
      } else {
        link.removeAttribute('aria-current');
      }
    }
    return label;
  };

  const show = async (url: URL, push: boolean) => {
    pending?.abort();
    pending = null;
    if (key(url) === shown) {
      // Back to the list already on screen: undo what a choice still loading had marked.
      markCurrent(categoryOf(url));
      feed.removeAttribute('aria-busy');
      return;
    }
    const controller = new AbortController();
    pending = controller;
    const label = markCurrent(categoryOf(url));
    feed.setAttribute('aria-busy', 'true');
    try {
      const page = await fetchPage(url, controller.signal);
      const list = page.querySelector<HTMLElement>('[data-post-feed]');
      if (!list) throw new Error(`${key(url)} has no post list.`);
      stopRows();
      const next = document.adoptNode(list);
      next.dataset.revealed = '';
      feed.replaceWith(next);
      feed = next;
      stopRows = startRows(feed);
      shown = key(url);
      if (push) history.pushState(null, '', url);
      if (status) status.textContent = (nav.dataset.announce ?? '{name}').replace('{name}', label);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('The category could not be shown in place; following its link:', error);
      location.assign(url);
    } finally {
      if (pending === controller) pending = null;
    }
  };

  nav.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void show(new URL(link.href), true);
  });
  window.addEventListener('popstate', () => void show(new URL(location.href), false));
}

export default function wirePostFeed(feed: HTMLElement, nav: HTMLElement | null): void {
  const stopRows = startRows(feed);
  if (nav) wireFilter(nav, feed, stopRows);
}
