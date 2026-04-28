import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as appleApi from '../services/api/apple'
import * as progressApi from '../services/api/progress'

export interface AppleProduct {
  id: string
  productId: string
  referenceName: string
  type: string
  state: string
  territoryCount: number
  basePrice: string
  baseCurrency: string
  syncedAt: string
}

export const useAppleProductsStore = defineStore('apple-products', () => {
  const products = ref<AppleProduct[]>([])
  const selected = ref<Set<string>>(new Set())
  const selectedProduct = ref<AppleProduct | null>(null)
  const loading = ref(false)
  const syncing = ref(false)
  const exporting = ref(false)
  const syncProgress = ref('')
  const exportProgress = ref('')

  // The setup function runs exactly once per Pinia instance. In production
  // there's only one Pinia, so these listeners attach once for the app's
  // lifetime. Tests build a fresh Pinia per case, which intentionally
  // re-attaches against the freshly mocked progress API.
  progressApi.onSync((data) => {
    syncProgress.value = data.phase
  })
  progressApi.onExport((data) => {
    exportProgress.value = data.phase
  })

  // Reset everything tied to a single project. AppleProductTable mounts /
  // unmounts when the user switches project, so we call reset on both ends
  // to keep stale state from leaking across projects.
  function reset() {
    products.value = []
    selected.value = new Set()
    selectedProduct.value = null
    loading.value = false
    syncing.value = false
    exporting.value = false
    syncProgress.value = ''
    exportProgress.value = ''
  }

  async function loadCached(projectId: string) {
    loading.value = true
    const result = await appleApi.getCachedProducts(projectId)
    if (result.success) {
      products.value = result.data
    }
    loading.value = false
    return result
  }

  // The caller is expected to set syncProgress beforehand if it wants an
  // initial phase string ("正在連線..." in zh-TW) — keeping the i18n call
  // in the component avoids pulling vue-i18n into the store. Once the
  // main-process listener kicks in, it overwrites this with phase updates.
  async function syncProducts(projectId: string) {
    syncing.value = true
    const result = await appleApi.fetchProducts(projectId)
    syncing.value = false
    syncProgress.value = ''
    if (result.success) {
      products.value = result.data
      selected.value = new Set()
    }
    return result
  }

  function toggleSelection(id: string) {
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
  }

  function clearSelection() {
    selected.value = new Set()
  }

  function setSelection(ids: Iterable<string>) {
    selected.value = new Set(ids)
  }

  function setSelectedProduct(p: AppleProduct | null) {
    selectedProduct.value = p
  }

  // Mutators called by detail tabs after a successful save. Both
  // selectedProduct.value and the matching row in products[] hold the same
  // object reference, so editing the selectedProduct in place updates the
  // table row too.
  function updateProductReferenceName(name: string) {
    if (selectedProduct.value) selectedProduct.value.referenceName = name
  }

  function updateProductTerritoryCount(count: number) {
    if (selectedProduct.value) selectedProduct.value.territoryCount = count
  }

  function updateProductPrice(price: string, currency: string) {
    if (selectedProduct.value) {
      selectedProduct.value.basePrice = price
      selectedProduct.value.baseCurrency = currency
    }
  }

  // Mutators used by batch flows that iterate over many products by id.
  function updateProductBasePriceById(id: string, price: string, currency: string) {
    const p = products.value.find((p) => p.id === id)
    if (p) {
      p.basePrice = price
      p.baseCurrency = currency
    }
  }

  function updateProductTerritoryCountById(id: string, count: number) {
    const p = products.value.find((p) => p.id === id)
    if (p) p.territoryCount = count
  }

  return {
    products,
    selected,
    selectedProduct,
    loading,
    syncing,
    exporting,
    syncProgress,
    exportProgress,
    reset,
    loadCached,
    syncProducts,
    toggleSelection,
    clearSelection,
    setSelection,
    setSelectedProduct,
    updateProductReferenceName,
    updateProductTerritoryCount,
    updateProductPrice,
    updateProductBasePriceById,
    updateProductTerritoryCountById
  }
})
