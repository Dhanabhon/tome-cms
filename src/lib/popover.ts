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

/** A fixed panel's containing block as it is drawn, and its size before any transform. */
export interface DrawnBlock {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  laidOutWidth: number;
  laidOutHeight: number;
}

/**
 * The offsets that put a fixed panel where it was placed in the window (`wanted`, as placePopover
 * gives it). A box around it with a transform -- a dialog or a drawer still sliding in -- is its
 * containing block until the transform ends, and offsets are measured from that box as it is
 * drawn: from its edges, at its scale. In the window, they are the ones asked for. Exact for a box
 * that moves and scales (a dialog arriving at 0.98); a rotation is not one any overlay here makes.
 */
export function insetsWithin(block: DrawnBlock, wanted: { left: number; top: number | null; bottom: number | null; viewportHeight: number }) {
  const scaleX = block.laidOutWidth > 0 && block.width > 0 ? block.width / block.laidOutWidth : 1;
  const scaleY = block.laidOutHeight > 0 && block.height > 0 ? block.height / block.laidOutHeight : 1;
  return {
    left: (wanted.left - block.left) / scaleX,
    top: wanted.top === null ? null : (wanted.top - block.top) / scaleY,
    // Up from the box's bottom edge to where the panel's bottom should be in the window.
    bottom: wanted.bottom === null ? null : (block.bottom - (wanted.viewportHeight - wanted.bottom)) / scaleY,
  };
}

/**
 * The containing block a fixed `panel` is placed in, as drawn now: an empty fixed box beside it,
 * stretched to all four edges, is that block. Measured with a box of its own rather than the
 * panel, whose own entrance (a menu dropping in) is not the block moving.
 */
export function drawnContainingBlock(panel: HTMLElement): DrawnBlock {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;transform:none;transition:none;animation:none';
  (panel.parentElement ?? document.body).append(probe);
  const { left, top, bottom, width, height } = probe.getBoundingClientRect();
  const block = { left, top, bottom, width, height, laidOutWidth: probe.offsetWidth, laidOutHeight: probe.offsetHeight };
  probe.remove();
  return block;
}
