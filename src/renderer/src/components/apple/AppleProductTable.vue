<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../stores/notification.store'
import { useAppleProductsStore } from '../../stores/apple-products.store'
import AppleProductDetail from './AppleProductDetail.vue'
import AppleImportDialog from './AppleImportDialog.vue'
import AppleBatchAvailabilityDialog from './AppleBatchAvailabilityDialog.vue'
import AppleCreateProductDialog from './AppleCreateProductDialog.vue'
import { formatPrice } from '../../utils/format-price'
import * as appleApi from '../../services/api/apple'
import * as dialogApi from '../../services/api/dialog'

const props = defineProps<{ projectId: string }>()
const { t, te, locale } = useI18n()
const notify = useNotificationStore()
const store = useAppleProductsStore()

// Pure UI state — kept local because no other component cares about it.
const showCreateForm = ref(false)
const activeFilter = ref<string | null>(null)
const searchQuery = ref('')
const importFileContent = ref<string | null>(null)
const newProduct = ref({
  productId: '',
  referenceName: '',
  inAppPurchaseType: 'CONSUMABLE' as string
})

const existingProductIds = computed(() => store.products.map((p) => p.productId))

// Reset on mount AND unmount: project switches re-mount this component, and
// we want the store cleared on the way in (defence against an unclean prior
// unmount) and on the way out (so the next project starts clean).
onMounted(async () => {
  store.reset()
  await store.loadCached(props.projectId)
})
onUnmounted(() => {
  store.reset()
})

// Status filter
const STATUS_ORDER: Record<string, number> = {
  APPROVED: 0,
  READY_TO_SUBMIT: 1,
  WAITING_FOR_REVIEW: 2,
  IN_REVIEW: 3,
  MISSING_METADATA: 4,
  DEVELOPER_ACTION_NEEDED: 5,
  PENDING_BINARY_UPLOAD: 6,
  WAITING_FOR_UPLOAD: 7,
  PROCESSING_CONTENT: 8,
  REJECTED: 9,
  DEVELOPER_REMOVED_FROM_SALE: 10,
  REMOVED_FROM_SALE: 11
}

const statusGroups = computed(() => {
  const counts = new Map<string, number>()
  for (const p of store.products) {
    counts.set(p.state, (counts.get(p.state) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, label: stateLabel(state), count }))
    .sort((a, b) => (STATUS_ORDER[a.state] ?? 99) - (STATUS_ORDER[b.state] ?? 99))
})

const filteredProducts = computed(() => {
  let result = store.products
  if (activeFilter.value) {
    result = result.filter((p) => p.state === activeFilter.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(
      (p) => p.productId.toLowerCase().includes(q) || p.referenceName.toLowerCase().includes(q)
    )
  }
  return result
})

const allSelected = computed(() => {
  return filteredProducts.value.length > 0 && store.selected.size === filteredProducts.value.length
})

// Computed so labels track the current locale.
const batchActions = computed(() => [
  { key: 'sync-price', label: t('apple.batch.syncPrice') },
  { key: 'sync-availability', label: t('apple.batch.syncAvailability') },
  { key: 'set-availability', label: t('apple.batch.setAvailability.action') },
  { key: 'activate', label: t('apple.batch.activate') },
  { key: 'deactivate', label: t('apple.batch.deactivate'), variant: 'danger' as const }
])

const showBatchAvailability = ref(false)
const selectedProducts = computed(() => store.products.filter((p) => store.selected.has(p.id)))

async function onBatchAvailabilityDone() {
  showBatchAvailability.value = false
  store.clearSelection()
  // The main process already wrote the new counts to the local DB.
  await store.loadCached(props.projectId)
}

async function syncAll() {
  // Set the initial phase string here (not in the store) so the i18n call
  // stays in the component layer. The main-process progress listener will
  // overwrite this with concrete phase updates as the sync proceeds.
  store.syncProgress = t('apple.progress.connecting')
  const result = await store.syncProducts(props.projectId)
  if (result.success) {
    notify.success(t('apple.toast.syncSuccess', { count: result.data.length }))
  } else {
    notify.error(result.error || t('apple.toast.syncFail'))
  }
}

function toggleAll() {
  if (allSelected.value) {
    store.clearSelection()
  } else {
    store.setSelection(filteredProducts.value.map((p) => p.id))
  }
}

function setFilter(state: string | null) {
  activeFilter.value = activeFilter.value === state ? null : state
  store.clearSelection()
}

async function handleBatchAction(key: string) {
  const ids = Array.from(store.selected)
  if (ids.length === 0) return

  if (key === 'sync-price') {
    store.syncing = true
    let success = 0
    const total = ids.length
    for (const id of ids) {
      store.syncProgress = t('apple.progress.syncingPrice', { current: success + 1, total })
      const result = await appleApi.syncBasePrice(props.projectId, id)
      if (result.success) {
        store.updateProductBasePriceById(id, result.data.basePrice, result.data.baseCurrency)
        success++
      }
    }
    store.syncing = false
    store.syncProgress = ''
    notify.success(t('apple.toast.syncedPrice', { count: success }))
    return
  }

  if (key === 'sync-availability') {
    store.syncing = true
    let success = 0
    const total = ids.length
    for (const id of ids) {
      store.syncProgress = t('apple.progress.syncingAvail', { current: success + 1, total })
      const result = await appleApi.syncAvailability(props.projectId, id)
      if (result.success) {
        store.updateProductTerritoryCountById(id, result.data.territoryCount)
        success++
      }
    }
    store.syncing = false
    store.syncProgress = ''
    notify.success(t('apple.toast.syncedAvail', { count: success }))
    return
  }

  if (key === 'set-availability') {
    showBatchAvailability.value = true
    return
  }

  if (key === 'activate' || key === 'deactivate') {
    const available = key === 'activate'
    const confirmKey = available ? 'apple.batch.confirmActivate' : 'apple.batch.confirmDeactivate'
    const processingKey = available
      ? 'apple.batch.processingActivate'
      : 'apple.batch.processingDeactivate'
    const successKey = available ? 'apple.batch.activateSuccess' : 'apple.batch.deactivateSuccess'

    if (!confirm(t(confirmKey, { count: ids.length }))) return

    notify.info(t(processingKey))
    const result = await appleApi.batchUpdateAvailability(props.projectId, ids, available)
    if (result.success) {
      const { data } = result
      if (data.failed.length > 0) {
        const details = data.failed
          .map((f: { id: string; error: string }) => `${f.id}: ${f.error}`)
          .join('\n')
        notify.error(t('apple.batch.failedItems', { count: data.failed.length, details }))
      }
      if (data.success.length > 0) {
        notify.success(t(successKey, { count: data.success.length }))
      }
      store.clearSelection()
      // The main process already wrote the new territory counts to the local
      // DB, and a full sync wouldn't refresh them anyway — just reload the cache.
      await store.loadCached(props.projectId)
    } else {
      notify.error(result.error || t('apple.batch.opFailed'))
    }
  }
}

async function importProducts() {
  const result = await dialogApi.importFile([{ name: 'JSON', extensions: ['json'] }])
  if (!result.success || !result.data) return
  importFileContent.value = result.data
}

async function onImportDone() {
  importFileContent.value = null
  // Main process has already written the imported products to the local DB,
  // so just reload the cached list — no extra Apple API calls.
  await store.loadCached(props.projectId)
}

async function exportProducts() {
  if (store.products.length === 0) {
    notify.error(t('apple.toast.exportEmpty'))
    return
  }

  // Export selection if any boxes are checked, otherwise everything.
  const source =
    store.selected.size > 0
      ? store.products.filter((p) => store.selected.has(p.id))
      : store.products

  const payload = source.map((p) => ({
    id: p.id,
    productId: p.productId,
    referenceName: p.referenceName,
    type: p.type
  }))

  store.exporting = true
  store.exportProgress = t('apple.progress.exportPreparing')
  const result = await appleApi.exportProducts(props.projectId, payload)
  store.exporting = false
  store.exportProgress = ''

  if (!result.success) {
    notify.error(result.error || t('apple.toast.exportFail'))
    return
  }

  const data = result.data
  if (data.cancelled) return

  if (data.errors.length > 0) {
    const details = data.errors
      .map((e: { productId: string; error: string }) => `${e.productId}: ${e.error}`)
      .join('\n')
    notify.error(
      t('apple.toast.exportPartial', {
        exported: data.exported,
        total: data.total,
        failed: data.errors.length,
        details
      })
    )
  } else {
    notify.success(t('apple.toast.exportSuccess', { count: data.exported }))
  }
}

async function onProductCreated() {
  showCreateForm.value = false
  await syncAll()
}

// Translates an Apple product state enum value, falling back to the raw
// enum string when no translation exists (e.g. a brand-new state Apple
// adds before we ship a dictionary update).
function stateLabel(state: string): string {
  const key = `apple.state.${state}`
  return te(key) ? t(key) : state
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="mb-4 flex shrink-0 items-center justify-between px-6 pt-6">
      <div class="flex items-center gap-2">
        <button
          :disabled="store.syncing"
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          @click="syncAll"
        >
          {{ t('apple.toolbar.sync') }}
        </button>
        <button
          :disabled="store.exporting || store.syncing || store.products.length === 0"
          class="border-divider-strong hover:bg-divider rounded-lg border px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors disabled:opacity-50"
          @click="exportProducts"
        >
          {{ t('apple.toolbar.export') }}
        </button>
        <button
          :disabled="store.exporting || store.syncing"
          class="border-divider-strong hover:bg-divider rounded-lg border px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors disabled:opacity-50"
          @click="importProducts"
        >
          {{ t('apple.toolbar.import') }}
        </button>
        <span v-if="store.syncing" class="flex items-center gap-2 text-sm text-gray-400">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
          />
          {{ store.syncProgress }}
        </span>
        <span v-if="store.exporting" class="flex items-center gap-2 text-sm text-gray-400">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
          />
          {{ store.exportProgress }}
        </span>
        <span v-if="store.products.length > 0" class="text-sm whitespace-nowrap text-gray-500">
          {{
            filteredProducts.length !== store.products.length
              ? t('apple.toolbar.productCountFiltered', {
                  filtered: filteredProducts.length,
                  total: store.products.length
                })
              : t('apple.toolbar.productCount', { count: store.products.length })
          }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <input
          v-model="searchQuery"
          type="text"
          class="border-divider-strong bg-deep w-52 rounded-lg border px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          :placeholder="t('apple.toolbar.searchPlaceholder')"
        />
        <button
          class="border-divider-strong hover:bg-divider rounded-lg border px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors"
          @click="showCreateForm = true"
        >
          {{ t('apple.toolbar.create') }}
        </button>
      </div>
    </div>

    <!-- Batch Action Bar (inline) -->
    <div v-if="store.selected.size > 0" class="mb-3 flex shrink-0 items-center gap-3 px-6">
      <span class="text-sm whitespace-nowrap text-gray-300">
        {{ t('apple.batch.selected', { count: store.selected.size }) }}
      </span>
      <div class="bg-divider-strong h-5 w-px" />
      <button
        v-for="action in batchActions"
        :key="action.key"
        class="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors"
        :class="
          action.variant === 'danger'
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        "
        @click="handleBatchAction(action.key)"
      >
        {{ action.label }}
      </button>
      <button
        class="text-sm whitespace-nowrap text-gray-400 transition-colors hover:text-white"
        @click="store.clearSelection()"
      >
        {{ t('apple.batch.clearSelection') }}
      </button>
    </div>

    <!-- Status filter chips -->
    <div v-if="statusGroups.length > 0" class="mb-4 flex shrink-0 flex-wrap gap-2 px-6">
      <button
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
        :class="
          activeFilter === null
            ? 'bg-blue-600 text-white'
            : 'bg-card hover:bg-divider text-gray-400'
        "
        @click="setFilter(null)"
      >
        {{ t('apple.filter.all', { count: store.products.length }) }}
      </button>
      <button
        v-for="group in statusGroups"
        :key="group.state"
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
        :class="
          activeFilter === group.state
            ? 'bg-blue-600 text-white'
            : 'bg-card hover:bg-divider text-gray-400'
        "
        @click="setFilter(group.state)"
      >
        {{ group.label }} {{ group.count }}
      </button>
    </div>

    <AppleCreateProductDialog
      v-if="showCreateForm"
      :project-id="props.projectId"
      @close="showCreateForm = false"
      @created="onProductCreated"
    />

    <!-- Product Detail Modal -->
    <AppleProductDetail
      v-if="store.selectedProduct"
      :project-id="props.projectId"
      @close="store.setSelectedProduct(null)"
    />

    <!-- Batch availability -->
    <AppleBatchAvailabilityDialog
      v-if="showBatchAvailability"
      :project-id="props.projectId"
      :products="selectedProducts"
      @close="showBatchAvailability = false"
      @done="onBatchAvailabilityDone"
    />

    <!-- Import Dialog -->
    <AppleImportDialog
      v-if="importFileContent !== null"
      :project-id="props.projectId"
      :file-content="importFileContent"
      :existing-product-ids="existingProductIds"
      @close="importFileContent = null"
      @imported="onImportDone"
    />
  </div>
</template>
