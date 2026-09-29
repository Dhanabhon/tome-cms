/**
 * Where a panel opened from a control goes. It is position: fixed, so this is the whole of its
 * placement: below unless it does not fit there and more of it fits above, and capped by whichever
 * room it took -- shorter than it wants, never cut off by a dialog it happens to be inside.
 */
export function placePopover(
  trigger: DOMRect,
  panelHeight: number,
  viewportHeight: number,
  rootFontSize: number,
  { gap = 4, minHeight = 120, maxRows = 20, matchWidth = true }: { gap?: number; minHeight?: number; maxRows?: number; matchWidth?: boolean } = {},
) {
  const below = viewportHeight - trigger.bottom - gap;
  const above = trigger.top - gap;
  const flip = panelHeight > below && above > below;
  const room = Math.max(flip ? above : below, minHeight);
  return {
    left: trigger.left,
    width: matchWidth ? trigger.width : null,
    maxHeight: Math.min(room, maxRows * rootFontSize),
    top: flip ? null : trigger.bottom + gap,
    bottom: flip ? viewportHeight - trigger.top + gap : null,
  };
}
