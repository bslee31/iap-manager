import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const googleApi = vi.hoisted(() => ({
  getCachedProducts: vi.fn(),
  fetchProducts: vi.fn()
}))
vi.mock('../services/api/google', () => googleApi)

const progressApi = vi.hoisted(() => {
  const syncCallbacks: ((data: { phase: string }) => void)[] = []
  const exportCallbacks: ((data: { phase: string }) => void)[] = []
  return {
    syncCallbacks,
    exportCallbacks,
    onSync: (cb: (d: { phase: string }) => void) => {
      syncCallbacks.push(cb)
      return () => {}
    },
    onExport: (cb: (d: { phase: string }) => void) => {
      exportCallbacks.push(cb)
      return () => {}
    }
  }
})
vi.mock('../services/api/progress', () => ({
  onSync: progressApi.onSync,
  onExport: progressApi.onExport
}))

import { useGoogleProductsStore, type GoogleProduct } from './google-products.store'

function makeProduct(overrides: Partial<GoogleProduct> = {}): GoogleProduct {
  return {
    productId: 'com.example.coins',
    name: 'Coins 100',
    description: '100 coins',
    status: 'ACTIVE',
    syncedAt: '2026-04-28T00:00:00Z',
    ...overrides
  }
}

describe('useGoogleProductsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    googleApi.getCachedProducts.mockReset()
    googleApi.fetchProducts.mockReset()
    progressApi.syncCallbacks.length = 0
    progressApi.exportCallbacks.length = 0
  })

  it('starts with empty / falsy state', () => {
    const store = useGoogleProductsStore()
    expect(store.products).toEqual([])
    expect(store.selected).toEqual(new Set())
    expect(store.selectedProduct).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.syncing).toBe(false)
    expect(store.exporting).toBe(false)
    expect(store.syncProgress).toBe('')
    expect(store.exportProgress).toBe('')
  })

  it('reset clears every per-project field', () => {
    const store = useGoogleProductsStore()
    store.products = [makeProduct()]
    store.setSelection(['com.example.coins'])
    store.setSelectedProduct(makeProduct())
    store.loading = true
    store.syncing = true
    store.exporting = true
    store.syncProgress = 'fetching'
    store.exportProgress = 'exporting'

    store.reset()

    expect(store.products).toEqual([])
    expect(store.selected).toEqual(new Set())
    expect(store.selectedProduct).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.syncing).toBe(false)
    expect(store.exporting).toBe(false)
    expect(store.syncProgress).toBe('')
    expect(store.exportProgress).toBe('')
  })

  it('loadCached populates products on success', async () => {
    const list = [makeProduct({ productId: 'a' }), makeProduct({ productId: 'b' })]
    googleApi.getCachedProducts.mockResolvedValueOnce({ success: true, data: list })

    const store = useGoogleProductsStore()
    const promise = store.loadCached('p1')
    expect(store.loading).toBe(true)
    await promise

    expect(store.products).toEqual(list)
    expect(store.loading).toBe(false)
  })

  it('loadCached leaves products unchanged on failure', async () => {
    googleApi.getCachedProducts.mockResolvedValueOnce({ success: false, error: 'boom' })
    const store = useGoogleProductsStore()
    store.products = [makeProduct({ productId: 'kept' })]
    await store.loadCached('p1')
    expect(store.products).toEqual([makeProduct({ productId: 'kept' })])
    expect(store.loading).toBe(false)
  })

  it('syncProducts replaces products and clears selection on success', async () => {
    const list = [makeProduct({ productId: 'new' })]
    googleApi.fetchProducts.mockResolvedValueOnce({ success: true, data: list })

    const store = useGoogleProductsStore()
    store.setSelection(['old-1', 'old-2'])
    await store.syncProducts('p1')

    expect(store.products).toEqual(list)
    expect(store.selected).toEqual(new Set())
    expect(store.syncing).toBe(false)
    expect(store.syncProgress).toBe('')
  })

  it('syncProducts clears progress and flag on failure too', async () => {
    googleApi.fetchProducts.mockResolvedValueOnce({ success: false, error: 'down' })
    const store = useGoogleProductsStore()
    store.products = [makeProduct({ productId: 'kept' })]
    await store.syncProducts('p1')
    expect(store.products).toEqual([makeProduct({ productId: 'kept' })])
    expect(store.syncing).toBe(false)
    expect(store.syncProgress).toBe('')
  })

  // ── Selection helpers ──

  it('toggleSelection adds and removes ids', () => {
    const store = useGoogleProductsStore()
    store.toggleSelection('a')
    store.toggleSelection('b')
    expect(store.selected).toEqual(new Set(['a', 'b']))
    store.toggleSelection('a')
    expect(store.selected).toEqual(new Set(['b']))
  })

  it('clearSelection empties the selection', () => {
    const store = useGoogleProductsStore()
    store.setSelection(['a', 'b', 'c'])
    store.clearSelection()
    expect(store.selected).toEqual(new Set())
  })

  it('setSelectedProduct stores the chosen product', () => {
    const store = useGoogleProductsStore()
    const p = makeProduct()
    store.setSelectedProduct(p)
    expect(store.selectedProduct).toEqual(p)
    store.setSelectedProduct(null)
    expect(store.selectedProduct).toBeNull()
  })

  // ── Progress listeners ──

  it('sync progress listener updates syncProgress', () => {
    const store = useGoogleProductsStore()
    for (const cb of progressApi.syncCallbacks) cb({ phase: 'fetching products' })
    expect(store.syncProgress).toBe('fetching products')
  })

  it('export progress listener updates exportProgress', () => {
    const store = useGoogleProductsStore()
    for (const cb of progressApi.exportCallbacks) cb({ phase: 'fetching detail' })
    expect(store.exportProgress).toBe('fetching detail')
  })
})
