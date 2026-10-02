import { type RefObject, useEffect } from 'react';

/**
 * Tiptap makes a bubble's own box a tab stop, with no name and nothing to press: Tab from the
 * selection landed there, and only a second Tab reached the bar's first button. This runs after
 * the bubble's plugin is set up, which is what sets it. It runs after every render, not once:
 * a bubble that is not drawn on the first render (the formatting bar waits for the editor's
 * state) is set up on a later one, and the effect would otherwise have come and gone before it.
 */
export function useUntabbableBubble(bar: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (bar.current) bar.current.tabIndex = -1;
  });
}
