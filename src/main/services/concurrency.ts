// Run an async worker over a list with bounded concurrency.
// Order of completion is non-deterministic, but `results[i]` always
// corresponds to `items[i]` so callers can pair results with inputs.
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return results
}

// Concurrency limits used across import/export pipelines. Imports stay at 3
// because the underlying PATCH endpoints are heavier and we want to avoid
// triggering rate limits mid-batch; exports can go higher because they only
// read.
export const IMPORT_CONCURRENCY = 3
export const EXPORT_CONCURRENCY = 5
