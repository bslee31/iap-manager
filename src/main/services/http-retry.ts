// Retries a fetch-like operation on transient failures (HTTP 429, 5xx, or
// network/timeout errors). Application-level errors (4xx other than 429) are
// returned to the caller untouched so business logic can react to them.
//
// The helper is intentionally generic over Response so it can wrap both the
// global fetch and any thin shim around it. Callers are responsible for
// reading the body once and turning the Response into their own error type.

export interface RetryOptions {
  // Total attempts including the first call. Default 3.
  attempts?: number
  // Initial backoff in ms. Doubled each retry. Default 500.
  baseDelayMs?: number
  // Per-attempt timeout in ms. Default 30_000.
  timeoutMs?: number
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Honour Retry-After when present (seconds or HTTP-date). Returns ms or null.
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return null
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const attempts = opts.attempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 500
  const timeoutMs = opts.timeoutMs ?? 30_000

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
    // Compose with any caller-supplied signal so user cancellation still
    // works alongside our per-attempt timeout — matches stock fetch's
    // single-signal contract instead of silently dropping init.signal.
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal
    try {
      const response = await fetch(url, { ...init, signal })
      clearTimeout(timer)

      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts - 1) {
        return response
      }
      // Drain the body so the underlying connection can be reused.
      try {
        await response.arrayBuffer()
      } catch {
        // ignore — body may already be consumed
      }
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const delay = retryAfter ?? baseDelayMs * 2 ** attempt
      await sleep(delay)
      continue
    } catch (e) {
      clearTimeout(timer)
      lastError = e
      if (attempt === attempts - 1) throw e
      await sleep(baseDelayMs * 2 ** attempt)
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastError ?? new Error('fetchWithRetry: exhausted attempts without result')
}
