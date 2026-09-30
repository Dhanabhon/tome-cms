/**
 * Where a panel opened from a control goes. It is position: fixed, so this is the whole of its
 * placement: below unless it does not fit there and more of it fits above, and capped by whichever
 * room it took -- shorter than it wants, never cut off by a dialog it happens to be inside.
 *
 * Across, a panel is at least as wide as its trigger and as wide as its own content wants, up to
 * the window less a gutter either side: a list never cuts off an option it could show. It starts
 * where its trigger does, and lines up with the trigger's end instead when it would run past the
 * window's edge from there, or when the trigger sits in the window's end half -- where a list
 * wider than its trigger would otherwise hang off the control's far side. Pass `panelWidth` and
 * `viewportWidth` to have it placed across; without them it keeps to its trigger's start.
 */
export function placePopover(
  trigger: DOMRect,
  panelHeight: number,
  viewportHeight: number,
  rootFontSize: number,
  {
    gap = 4,
    gutter = 8,
    matchWidth = true,
    maxRows = 20,
    minHeight = 120,
    panelWidth = 0,
    viewportWidth = Number.POSITIVE_INFINITY,
  }: { gap?: number; gutter?: number; matchWidth?: boolean; maxRows?: number; minHeight?: number; panelWidth?: number; viewportWidth?: number } = {},
) {
  const below = viewportHeight - trigger.bottom - gap;
  const above = trigger.top - gap;
  const flip = panelHeight > below && above > below;
  const room = Math.max(flip ? above : below, minHeight);
  const maxWidth = viewportWidth - 2 * gutter;
  const width = Math.min(Math.max(panelWidth, matchWidth ? trigger.width : 0), maxWidth);
  const toEdge = viewportWidth - trigger.left - gutter;
  const alignEnd = width > toEdge || trigger.left + trigger.width / 2 > viewportWidth / 2;
  return {
    left: alignEnd ? Math.max(gutter, trigger.left + trigger.width - width) : trigger.left,
    minWidth: matchWidth ? trigger.width : null,
    maxWidth: Number.isFinite(maxWidth) ? maxWidth : null,
    maxHeight: Math.min(room, maxRows * rootFontSize),
    top: flip ? null : trigger.bottom + gap,
    bottom: flip ? viewportHeight - trigger.top + gap : null,
  };
}
