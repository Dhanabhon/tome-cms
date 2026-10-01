import type { PostLocale } from '../types/cms';

/** How often an open editor checks in; the server holds a draft for the owner 45 s after the last one. */
export const EDITING_POLL_MS = 15_000;

/** Sent by an editor after each save it makes, with the draft's new updated_at as the detail. */
export const EDITOR_SAVED_EVENT = 'tome:editor-saved';

/** A hidden tab does not hold the draft: leaving it is how the owner lets an AI write again. */
export function shouldBeat(visibility: DocumentVisibilityState): boolean {
  return visibility === 'visible';
}

/**
 * The AI undo bar above the draft already says this write: it is one, and the bar names the same
 * app. A different app's write since is still said.
 */
export function undoBarTellsOf(touch: { action: 'read' | 'write'; clientName: string } | null, undoClient: string | null): boolean {
  return touch?.action === 'write' && touch.clientName === undoClient;
}

/**
 * One check at a time. A visibility change and an interval tick can ask together; the second is
 * skipped while the first is in flight, so an older answer never lands after a newer one.
 */
export function oneAtATime(run: () => Promise<void>): () => Promise<void> {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
    }
  };
}

/**
 * "1 minute ago" / "1 นาทีที่ผ่านมา". A touch is shown for 3 minutes at most, so minutes are
 * enough; a touch seconds old, or one a skewed clock puts ahead, still reads as a minute.
 */
export function relativeTime(at: string, now: number, locale: PostLocale | null | undefined): string {
  const minutes = Math.max(1, Math.round((now - Date.parse(at)) / 60_000));
  return new Intl.RelativeTimeFormat(locale === 'th' ? 'th' : 'en').format(-minutes, 'minute');
}
