/**
 * Run `fn` over every item in `items` with a bounded concurrency of
 * `limit`. Preserves input order in the output. Failures bubble up, but
 * already-running workers finish their current task before rejection.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const out: R[] = new Array(items.length);
  let cursor = 0;
  let failure: unknown = null;

  async function worker() {
    while (!failure) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        out[index] = await fn(items[index], index);
      } catch (err) {
        failure = err;
        return;
      }
    }
  }

  const workers = Array.from({ length: safeLimit }, worker);
  await Promise.all(workers);
  if (failure) throw failure;
  return out;
}

/** Split an array into fixed-size chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunk size must be > 0, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
