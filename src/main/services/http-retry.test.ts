import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithRetry } from './http-retry'

// Helper: build a Response-shaped object with a status and optional headers.
// Body is an empty ArrayBuffer so the retry path's body-drain works.
function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(new ArrayBuffer(0), {
    status,
    headers
  })
}

describe('fetchWithRetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns the first response when status is non-retryable', async () => {
    fetchMock.mockResolvedValueOnce(res(200))
    const r = await fetchWithRetry('https://x.test/')
    expect(r.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 4xx responses without retrying (caller handles app errors)', async () => {
    fetchMock.mockResolvedValueOnce(res(404))
    const r = await fetchWithRetry('https://x.test/')
    expect(r.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on 503 and returns the eventual success', async () => {
    fetchMock
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200))

    // baseDelayMs=1 keeps the test fast; use real timers because fetchWithRetry
    // mixes setTimeout for delay AND for AbortController-based per-attempt
    // timeout (fake timers makes timeout firing fragile).
    const r = await fetchWithRetry('https://x.test/', {}, { attempts: 3, baseDelayMs: 1 })
    expect(r.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries on 429 and stops at the attempts cap, returning the last response', async () => {
    fetchMock.mockResolvedValue(res(429))
    const r = await fetchWithRetry('https://x.test/', {}, { attempts: 3, baseDelayMs: 1 })
    expect(r.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('honours integer Retry-After (seconds)', async () => {
    fetchMock
      .mockResolvedValueOnce(res(429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(res(200))
    const start = Date.now()
    const r = await fetchWithRetry('https://x.test/', {}, { attempts: 2, baseDelayMs: 5_000 })
    const elapsed = Date.now() - start
    // Retry-After: 0 should override the 5s base delay — finishes near-instantly.
    expect(r.status).toBe(200)
    expect(elapsed).toBeLessThan(500)
  })

  it('retries on network errors and surfaces the last error if all attempts fail', async () => {
    const netErr = new Error('ECONNRESET')
    fetchMock.mockRejectedValue(netErr)
    await expect(
      fetchWithRetry('https://x.test/', {}, { attempts: 2, baseDelayMs: 1 })
    ).rejects.toThrow('ECONNRESET')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts an attempt that exceeds timeoutMs', async () => {
    fetchMock.mockImplementation((_url, init: RequestInit) => {
      // Resolve only when aborted, mimicking a stuck request.
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })

    await expect(
      fetchWithRetry('https://x.test/', {}, { attempts: 1, baseDelayMs: 1, timeoutMs: 20 })
    ).rejects.toThrow('aborted')
  })

  it('composes caller signal with the per-attempt timeout signal', async () => {
    // Confirm the caller's AbortSignal is honoured: aborting it pre-flight
    // should make fetchWithRetry surface the abort error on the very first
    // attempt without retrying.
    const ctrl = new AbortController()
    ctrl.abort()
    fetchMock.mockImplementation((_url, init: RequestInit) => {
      if (init.signal?.aborted) return Promise.reject(new Error('caller aborted'))
      return Promise.resolve(res(200))
    })

    await expect(
      fetchWithRetry('https://x.test/', { signal: ctrl.signal }, { attempts: 3, baseDelayMs: 1 })
    ).rejects.toThrow('caller aborted')
  })

  it('uses exponential backoff between retries', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(200))

    const start = Date.now()
    await fetchWithRetry('https://x.test/', {}, { attempts: 3, baseDelayMs: 30 })
    const elapsed = Date.now() - start

    // Expect at least baseDelay (30ms) + 2*baseDelay (60ms) = ~90ms between
    // the three attempts. Leave headroom for scheduler jitter.
    expect(elapsed).toBeGreaterThanOrEqual(80)
  })
})
