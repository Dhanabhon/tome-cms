/**
 * Runs uploads a few at a time. A worker that throws is its own row's failure: the queue swallows
 * it and moves on, because one refused file must not stop the rest. The worker reports its outcome
 * to the UI itself.
 */
export async function runQueue<T>(items: readonly T[], worker: (item: T, index: number) => Promise<void>, concurrency = 2): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try { await worker(items[index], index); } catch { /* reported by the worker's row */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
}
