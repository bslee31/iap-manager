import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Stub the Apple API module the store calls into.
const appleApi = vi.hoisted(() => ({
  getCachedProducts: vi.fn(),
  fetchProducts: vi.fn()
}))
vi.mock('../services/api/apple', () => appleApi)

// Capture progress listener callbacks so individual tests can simulate the
// main-process pushing phase updates.
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

import { useAppleProductsStore, type AppleProduct } from './apple-products.store'

function makeProduct(overrides: Partial<AppleProduct> = {}): AppleProduct {
  return {
    id: 'iap-1',
    productId: 'com.example.coins',
    referenceName: 'Coins 100',
    type: 'CONSUMABLE',
    state: 'READY_TO_SUBMIT',
    territoryCount: 5,
    basePrice: '0.99',
    baseCurrency: 'USD',
    syncedAt: '2026-04-28T00:00:00Z',
    ...overrides
  }
}

describe('useAppleProductsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    appleApi.getCachedProducts.mockReset()
    appleApi.fetchProducts.mockReset()
    // Drop callbacks captured by previous test's store so each test only
    // sees its own listener firing.
    progressApi.syncCallbacks.length = 0
    progressApi.exportCallbacks.length = 0
  })

  it('starts with empty / falsy state', () => {
    const store = useAppleProductsStore()
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
    const store = useAppleProductsStore()
    store.products = [makeProduct()]
    store.setSelection(['iap-1'])
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

  it('loadCached populates products on success and toggles loading', async () => {
    const list = [makeProduct({ id: 'a' }), makeProduct({ id: 'b' })]
    appleApi.getCachedProducts.mockResolvedValueOnce({ success: true, data: list })

    const store = useAppleProductsStore()
    const promise = store.loadCached('p1')
    expect(store.loading).toBe(true)
    await promise

    expect(store.products).toEqual(list)
    expect(store.loading).toBe(false)
  })

  it('loadCached leaves products unchanged on failure', async () => {
    appleApi.getCachedProducts.mockResolvedValueOnce({ success: false, error: 'boom' })
    const store = useAppleProductsStore()
    store.products = [makeProduct({ id: 'kept' })]
    await store.loadCached('p1')
    expect(store.products).toEqual([makeProduct({ id: 'kept' })])
    expect(store.loading).toBe(false)
  })

  it('syncProducts replaces products and clears selection on success', async () => {
    const list = [makeProduct({ id: 'new' })]
    appleApi.fetchProducts.mockResolvedValueOnce({ success: true, data: list })

    const store = useAppleProductsStore()
    store.setSelection(['old-1', 'old-2'])
    await store.syncProducts('p1')

    expect(store.products).toEqual(list)
    expect(store.selected).toEqual(new Set())
    expect(store.syncing).toBe(false)
    expect(store.syncProgress).toBe('')
  })

  it('syncProducts clears progress and flag on failure too', async () => {
    appleApi.fetchProducts.mockResolvedValueOnce({ success: false, error: 'down' })
    const store = useAppleProductsStore()
    store.products = [makeProduct({ id: 'kept' })]
    await store.syncProducts('p1')
    expect(store.products).toEqual([makeProduct({ id: 'kept' })])
    expect(store.syncing).toBe(false)
    expect(store.syncProgress).toBe('')
  })

  // ── Selection helpers ──

  it('toggleSelection adds and removes ids', () => {
    const store = useAppleProductsStore()
    store.toggleSelection('a')
    store.toggleSelection('b')
    expect(store.selected).toEqual(new Set(['a', 'b']))
    store.toggleSelection('a')
    expect(store.selected).toEqual(new Set(['b']))
  })

  it('clearSelection empties the selection', () => {
    const store = useAppleProductsStore()
    store.setSelection(['a', 'b', 'c'])
    store.clearSelection()
    expect(store.selected).toEqual(new Set())
  })

  it('setSelectedProduct stores the chosen product', () => {
    const store = useAppleProductsStore()
    const p = makeProduct()
    store.setSelectedProduct(p)
    // Pinia wraps the assigned object in a reactive proxy, so the identity
    // check via toBe fails; toEqual is the right shape check here.
    expect(store.selectedProduct).toEqual(p)
    store.setSelectedProduct(null)
    expect(store.selectedProduct).toBeNull()
  })

  // ── Mutators on selectedProduct ──

  it('updateProductReferenceName edits selectedProduct in place', () => {
    const store = useAppleProductsStore()
    const p = makeProduct({ referenceName: 'Old' })
    store.products = [p]
    store.setSelectedProduct(p)
    store.updateProductReferenceName('New')
    expect(store.selectedProduct?.referenceName).toBe('New')
    // The list row is the same object reference, so it sees the change too.
    expect(store.products[0].referenceName).toBe('New')
  })

  it('updateProductTerritoryCount edits selectedProduct in place', () => {
    const store = useAppleProductsStore()
    const p = makeProduct({ territoryCount: 3 })
    store.products = [p]
    store.setSelectedProduct(p)
    store.updateProductTerritoryCount(42)
    expect(store.selectedProduct?.territoryCount).toBe(42)
    expect(store.products[0].territoryCount).toBe(42)
  })

  it('updateProductPrice edits price and currency together', () => {
    const store = useAppleProductsStore()
    const p = makeProduct({ basePrice: '0.99', baseCurrency: 'USD' })
    store.products = [p]
    store.setSelectedProduct(p)
    store.updateProductPrice('30', 'TWD')
    expect(store.selectedProduct?.basePrice).toBe('30')
    expect(store.selectedProduct?.baseCurrency).toBe('TWD')
    expect(store.products[0].basePrice).toBe('30')
  })

  it('mutators are no-ops when no selectedProduct is set', () => {
    const store = useAppleProductsStore()
    expect(() => {
      store.updateProductReferenceName('whatever')
      store.updateProductTerritoryCount(1)
      store.updateProductPrice('1', 'USD')
    }).not.toThrow()
  })

  // ── Mutators by id (batch flow) ──

  it('updateProductBasePriceById updates the matching row', () => {
    const store = useAppleProductsStore()
    store.products = [makeProduct({ id: 'a' }), makeProduct({ id: 'b' })]
    store.updateProductBasePriceById('b', '5.99', 'USD')
    expect(store.products[1].basePrice).toBe('5.99')
    expect(store.products[0].basePrice).toBe('0.99')
  })

  it('updateProductTerritoryCountById is a no-op when id is unknown', () => {
    const store = useAppleProductsStore()
    store.products = [makeProduct({ id: 'a', territoryCount: 5 })]
    store.updateProductTerritoryCountById('ghost', 99)
    expect(store.products[0].territoryCount).toBe(5)
  })

  // ── Progress listeners ──

  it('sync progress listener updates syncProgress', () => {
    const store = useAppleProductsStore()
    for (const cb of progressApi.syncCallbacks) cb({ phase: 'reading territories' })
    expect(store.syncProgress).toBe('reading territories')
  })

  it('export progress listener updates exportProgress', () => {
    const store = useAppleProductsStore()
    for (const cb of progressApi.exportCallbacks) cb({ phase: 'fetching localizations' })
    expect(store.exportProgress).toBe('fetching localizations')
  })
})
