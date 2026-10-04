import type { Page } from '@playwright/test';

/** What a finger presses. A link inside running text is exempt (WCAG 2.5.8), as is anything not shown. */
export const TARGET_SELECTOR = 'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]';
export const RUNNING_TEXT = '.prose, .plain-body, .almanac-prose';
export const MIN = 44;

/**
 * Every visible target under 44 × 44 CSS px, as "selector-ish W×H" lines. A box of 1 px or less is a
 * visually hidden control (a skip link, a switch's input) that no finger reaches; its label or its
 * focused state is what is pressed, so it is skipped.
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
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      if (box.width < min || box.height < min) found.push(`${describe(element)} ${Math.round(box.width)}×${Math.round(box.height)}`);
    }
    return found;
  }, { selector: TARGET_SELECTOR, runningText: RUNNING_TEXT, min: MIN, allowed });
}
