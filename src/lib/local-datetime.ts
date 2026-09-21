/**
 * Between the value a `datetime-local` input holds and the instant a row stores.
 *
 * The input has no timezone at all: it is the wall clock in front of whoever is typing.
 * The row keeps an instant. Turning one into the other is the whole of this file, and it
 * lives here because two drawers do it and a wrong answer is an article that appears at the
 * wrong hour -- which nobody finds out about until it has already happened.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** What the input should show for a stored instant, in the reader's own clock. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** What to store for what the input holds. Empty means the owner named no date. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

/** Published, and the moment has not come: the one state the two dates do not share. */
export function isScheduled(status: string, publishedAt: string | null | undefined, now = Date.now()): boolean {
  if (status !== 'published' || !publishedAt) return false;
  const when = new Date(publishedAt).getTime();
  return !Number.isNaN(when) && when > now;
}
