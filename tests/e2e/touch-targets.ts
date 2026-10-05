import type { Page } from '@playwright/test';

/**
 * What a finger presses. A link inside running text is exempt (WCAG 2.5.8), as is anything not shown.
 * An option is pressed too: the editor's slash menu is a listbox whose options take no focus.
 */
export const TARGET_SELECTOR = 'a[href], button, [role="button"], [role="option"], input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]';
export const RUNNING_TEXT = '.prose, .plain-body, .almanac-prose';
export const MIN = 44;

/**
 * Every visible target under 44 × 44 CSS px, as "selector-ish W×H" lines. A box of 1 px or less is a
 * visually hidden control (a skip link, a switch's input) that no finger reaches; its label or its
 * focused state is what is pressed, so it is skipped. A checkbox or radio is measured by its label.
 */
export async function smallTargets(page: Page, allowed: readonly string[] = []): Promise<string[]> {
  return page.evaluate(({ selector, runningText, min, allowed: allow }) => {
    const describe = (element: Element) => {
      const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join('');
      const label = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${element.tagName.toLowerCase()}${classes} "${label}"`;
    };
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest(runningText) || allow.some((rule) => element.matches(rule))) continue;
      // Not shown: display none, visibility hidden, or inside a closed <details>, whose contents Chromium
      // still lays out (content-visibility: hidden) at a width no one sees.
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      // A checkbox or a radio is pressed through the label around it, when that label is a box of its own.
      const label = element.matches('input[type="checkbox"], input[type="radio"]') ? element.closest('label') : null;
      const box = (label?.getClientRects().length ? label : element).getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      if (box.width < min || box.height < min) found.push(`${describe(element)} ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return found;
  }, { selector: TARGET_SELECTOR, runningText: RUNNING_TEXT, min: MIN, allowed });
}

const MENUS = 'details, [popover]';

/** Opens the menus whose flag is set and closes the rest, in document order, so a parent opens before its child. */
async function setMenus(page: Page, open: readonly boolean[]): Promise<void> {
  await page.evaluate(({ selector, flags }) => {
    [...document.querySelectorAll<HTMLElement>(selector)].forEach((menu, at) => {
      if (menu instanceof HTMLDetailsElement) menu.open = flags[at];
      else if (menu.matches(':popover-open') !== flags[at]) menu.togglePopover(flags[at]);
    });
  }, { selector: MENUS, flags: open });
  // A menu grows into place as it opens, and a box mid-way is a scaled one: it is measured at rest. Only
  // transitions are waited on -- a slider's paused or scroll-driven animation never finishes -- and a
  // cancelled one rejects its promise, which is as good as done.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation instanceof CSSTransition)
    .map((animation) => animation.finished.catch(() => undefined))));
}

/**
 * The small targets as the page loads, and then with each menu open in turn (its parent menus too): what a
 * closed <details> or popover holds is not shown, so it is measured where a finger meets it, open. One at a
 * time, as the header's sub-menus share a name and so only one of them is ever open. The menus are left as
 * they were found, so what the test does next meets the page it had.
 */
export async function everyState(page: Page, allowed: readonly string[] = []): Promise<string[]> {
  const found = new Set(await smallTargets(page, allowed));
  const { initial, chains } = await page.evaluate((selector) => {
    const all = [...document.querySelectorAll<HTMLElement>(selector)];
    return {
      initial: all.map((menu) => (menu instanceof HTMLDetailsElement ? menu.open : menu.matches(':popover-open'))),
      // Each menu with every menu that holds it: what has to be open for it to be seen.
      chains: all.map((menu) => all.map((other) => other.contains(menu))),
    };
  }, MENUS);
  for (const open of chains) {
    await setMenus(page, open);
    for (const line of await smallTargets(page, allowed)) found.add(line);
  }
  await setMenus(page, initial);
  return [...found];
}
