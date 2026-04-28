import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as googleApi from '../services/api/google'
import * as progressApi from '../services/api/progress'

export interface GoogleProduct {
  productId: string
  name: string
  description: string
  status: string
  purchaseOptionId?: string
  purchaseOptionCount?: number
  activePurchaseOptionCount?: number
  basePrice?: string
  baseCurrency?: string
  syncedAt: string
}

export const useGoogleProductsStore = defineStore('google-products', () => {
  const products = ref<GoogleProduct[]>([])
  const selected = ref<Set<string>>(new Set())
  const selectedProduct = ref<GoogleProduct | null>(null)
  const loading = ref(false)
  const syncing = ref(false)
  const exporting = ref(false)
  const syncProgress = ref('')
  const exportProgress = ref('')

  // Pinia's setup function runs exactly once per Pinia instance. In production
  // there's only one Pinia, so these listeners attach for the app's lifetime.
  // Tests build a fresh Pinia per case, intentionally re-attaching against
  // the freshly mocked progress API.
  progressApi.onSync((data) => {
    syncProgress.value = data.phase
  })
  progressApi.onExport((data) => {
    exportProgress.value = data.phase
  })

  // Reset everything tied to a single project. GoogleProductTable mounts /
  // unmounts when the user switches project; reset on both ends keeps stale
  // state from leaking across projects.
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
    const result = await googleApi.getCachedProducts(projectId)
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
    const result = await googleApi.fetchProducts(projectId)
    syncing.value = false
    syncProgress.value = ''
    if (result.success) {
      products.value = result.data
      selected.value = new Set()
    }
    return result
  }

  function toggleSelection(productId: string) {
    const next = new Set(selected.value)
    if (next.has(productId)) next.delete(productId)
    else next.add(productId)
    selected.value = next
  }

  function clearSelection() {
    selected.value = new Set()
  }

  function setSelection(ids: Iterable<string>) {
    selected.value = new Set(ids)
  }

  function setSelectedProduct(p: GoogleProduct | null) {
    selectedProduct.value = p
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
    setSelectedProduct
  }
})
