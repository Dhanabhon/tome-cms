/**
 * The least time a pressed button says it is working, everywhere in the admin.
 *
 * A save on a quick server answers in about twenty milliseconds, and a spinner shown for one
 * frame reads as nothing having happened. Four hundred is long enough to be seen and short
 * enough not to be waited on. One number, so the whole admin changes together.
 */
export const MIN_BUSY_MS = 400;

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * The work, taking at least as long as a busy button needs to be seen.
 *
 * A slower answer is not held back. A failure waits the same minimum, so its message does not
 * flash in before the spinner could be seen either.
 */
export async function atLeast<T>(
  work: Promise<T>,
  milliseconds = MIN_BUSY_MS,
  wait: (milliseconds: number) => Promise<void> = pause,
): Promise<T> {
  const [outcome] = await Promise.allSettled([work, wait(milliseconds)]);
  if (outcome.status === 'rejected') throw outcome.reason;
  return outcome.value;
}
