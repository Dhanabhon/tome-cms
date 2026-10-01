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
 * "1 minute ago" / "1 นาทีที่ผ่านมา". A touch is shown for 3 minutes at most, so minutes are
 * enough; a touch seconds old, or one a skewed clock puts ahead, still reads as a minute.
 */
export function relativeTime(at: string, now: number, locale: PostLocale | null | undefined): string {
  const minutes = Math.max(1, Math.round((now - Date.parse(at)) / 60_000));
  return new Intl.RelativeTimeFormat(locale === 'th' ? 'th' : 'en').format(-minutes, 'minute');
}
