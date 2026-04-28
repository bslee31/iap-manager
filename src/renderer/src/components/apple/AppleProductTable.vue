<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import { useAppleProductsStore } from '../../stores/apple-products.store'
import AppleProductDetail from './AppleProductDetail.vue'
import AppleImportDialog from './AppleImportDialog.vue'
import * as appleApi from '../../services/api/apple'
import * as dialogApi from '../../services/api/dialog'

const props = defineProps<{ projectId: string }>()
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

const batchActions = [
  { key: 'sync-price', label: '重整 Price' },
  { key: 'sync-availability', label: '重整 Availability' },
  { key: 'activate', label: '批次上架' },
  { key: 'deactivate', label: '批次下架', variant: 'danger' as const }
]

async function syncAll() {
  const result = await store.syncProducts(props.projectId)
  if (result.success) {
    notify.success(`同步完成，共 ${result.data.length} 個商品`)
  } else {
    notify.error(result.error || '同步失敗')
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
      store.syncProgress = `重整 Price... ${success + 1}/${total}`
      const result = await appleApi.syncBasePrice(props.projectId, id)
      if (result.success) {
        store.updateProductBasePriceById(id, result.data.basePrice, result.data.baseCurrency)
        success++
      }
    }
    store.syncing = false
    store.syncProgress = ''
    notify.success(`已重整 ${success} 個商品的價格`)
    return
  }

  if (key === 'sync-availability') {
    store.syncing = true
    let success = 0
    const total = ids.length
    for (const id of ids) {
      store.syncProgress = `重整 Availability... ${success + 1}/${total}`
      const result = await appleApi.syncAvailability(props.projectId, id)
      if (result.success) {
        store.updateProductTerritoryCountById(id, result.data.territoryCount)
        success++
      }
    }
    store.syncing = false
    store.syncProgress = ''
    notify.success(`已重整 ${success} 個商品的 Availability`)
    return
  }

  if (key === 'activate' || key === 'deactivate') {
    const available = key === 'activate'
    const label = available ? '上架' : '下架'

    if (!confirm(`確定要${label}選取的 ${ids.length} 個商品嗎？`)) return

    notify.info(`正在批次${label}...`)
    const result = await appleApi.batchUpdateAvailability(props.projectId, ids, available)
    if (result.success) {
      const { data } = result
      if (data.failed.length > 0) {
        const errors = data.failed
          .map((f: { id: string; error: string }) => `${f.id}: ${f.error}`)
          .join('\n')
        notify.error(`失敗 ${data.failed.length} 項\n${errors}`)
      }
      if (data.success.length > 0) {
        notify.success(`成功${label} ${data.success.length} 項`)
      }
      store.clearSelection()
      await syncAll()
    } else {
      notify.error(result.error || '操作失敗')
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
    notify.error('沒有可匯出的商品，請先同步')
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
  store.exportProgress = '準備匯出...'
  const result = await appleApi.exportProducts(props.projectId, payload)
  store.exporting = false
  store.exportProgress = ''

  if (!result.success) {
    notify.error(result.error || '匯出失敗')
    return
  }

  const data = result.data
  if (data.cancelled) return

  if (data.errors.length > 0) {
    const lines = data.errors
      .map((e: { productId: string; error: string }) => `${e.productId}: ${e.error}`)
      .join('\n')
    notify.error(`已匯出 ${data.exported}/${data.total}，${data.errors.length} 項失敗\n${lines}`)
  } else {
    notify.success(`匯出完成：${data.exported} 個商品`)
  }
}

async function createProduct() {
  if (!newProduct.value.productId || !newProduct.value.referenceName) {
    notify.error('請填寫商品 ID 和名稱')
    return
  }

  const result = await appleApi.createProduct(props.projectId, {
    ...newProduct.value,
    appId: '' // Filled from credentials in the main process
  })

  if (result.success) {
    notify.success('商品已建立')
    showCreateForm.value = false
    newProduct.value = { productId: '', referenceName: '', inAppPurchaseType: 'CONSUMABLE' }
    await syncAll()
  } else {
    notify.error(result.error || '建立失敗')
  }
}

function stateLabel(state: string): string {
  const map: Record<string, string> = {
    APPROVED: '已核准',
    DEVELOPER_ACTION_NEEDED: '需開發者處理',
    DEVELOPER_REMOVED_FROM_SALE: '已下架',
    IN_REVIEW: '審核中',
    MISSING_METADATA: '缺少資料',
    PENDING_BINARY_UPLOAD: '待上傳',
    PROCESSING_CONTENT: '處理中',
    READY_TO_SUBMIT: '準備提交',
    REJECTED: '已拒絕',
    REMOVED_FROM_SALE: '已下架',
    WAITING_FOR_REVIEW: '等待審核',
    WAITING_FOR_UPLOAD: '待上傳'
  }
  return map[state] || state
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    CONSUMABLE: '消耗型',
    NON_CONSUMABLE: '非消耗型',
    NON_RENEWING_SUBSCRIPTION: '非續訂型訂閱'
  }
  return map[type] || type
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
          同步商品
        </button>
        <button
          :disabled="store.exporting || store.syncing || store.products.length === 0"
          class="rounded-lg border border-[#43454a] px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
          @click="exportProducts"
        >
          匯出
        </button>
        <button
          :disabled="store.exporting || store.syncing"
          class="rounded-lg border border-[#43454a] px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
          @click="importProducts"
        >
          匯入
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
              ? `${filteredProducts.length} / `
              : ''
          }}{{ store.products.length }} 個商品
        </span>
      </div>
      <div class="flex items-center gap-3">
        <input
          v-model="searchQuery"
          type="text"
          class="w-52 rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          placeholder="搜尋 Product ID / Name..."
        />
        <button
          class="rounded-lg border border-[#43454a] px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40]"
          @click="showCreateForm = true"
        >
          + 新增商品
        </button>
      </div>
    </div>

    <!-- Batch Action Bar (inline) -->
    <div v-if="store.selected.size > 0" class="mb-3 flex shrink-0 items-center gap-3 px-6">
      <span class="text-sm whitespace-nowrap text-gray-300">已選 {{ store.selected.size }} 項</span>
      <div class="h-5 w-px bg-[#43454a]" />
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
        取消選取
      </button>
    </div>

    <!-- Status filter chips -->
    <div v-if="statusGroups.length > 0" class="mb-4 flex shrink-0 flex-wrap gap-2 px-6">
      <button
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
        :class="
          activeFilter === null
            ? 'bg-blue-600 text-white'
            : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'
        "
        @click="setFilter(null)"
      >
        全部 {{ store.products.length }}
      </button>
      <button
        v-for="group in statusGroups"
        :key="group.state"
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
        :class="
          activeFilter === group.state
            ? 'bg-blue-600 text-white'
            : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'
        "
        @click="setFilter(group.state)"
      >
        {{ group.label }} {{ group.count }}
      </button>
    </div>

    <!-- Create Form Modal -->
    <div
      v-if="showCreateForm"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      @click.self="showCreateForm = false"
    >
      <div
        class="titlebar-no-drag w-full max-w-md rounded-xl border border-[#393b40] bg-[#2b2d30] p-6 shadow-xl"
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-100">新增 Apple IAP</h3>
          <button
            class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
            @click="showCreateForm = false"
          >
            &times;
          </button>
        </div>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">Product ID</label>
            <input
              v-model="newProduct.productId"
              type="text"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="例：com.example.coins100"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">Reference Name</label>
            <input
              v-model="newProduct.referenceName"
              type="text"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="例：100 金幣"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">類型</label>
            <select
              v-model="newProduct.inAppPurchaseType"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="CONSUMABLE">消耗型</option>
              <option value="NON_CONSUMABLE">非消耗型</option>
            </select>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button
            class="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-[#393b40]"
            @click="showCreateForm = false"
          >
            取消
          </button>
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
            @click="createProduct"
          >
            建立
          </button>
        </div>
      </div>
    </div>

    <!-- Product Table -->
    <div class="min-h-0 flex-1 px-6 pb-6">
      <div
        v-if="filteredProducts.length > 0"
        class="flex h-full flex-col overflow-hidden rounded-xl border border-[#393b40] bg-[#2b2d30]"
      >
        <!-- Fixed header -->
        <div class="shrink-0 pr-[6px]">
          <table class="w-full table-fixed">
            <colgroup>
              <col class="w-10" />
              <col class="w-[19%]" />
              <col class="w-[20%]" />
              <col class="w-[15%]" />
              <col class="w-[15%]" />
              <col class="w-[16%]" />
              <col class="w-[12%]" />
            </colgroup>
            <thead>
              <tr class="border-b border-[#393b40] bg-[#22252a]">
                <th class="px-3 py-3">
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    class="rounded"
                    @change="toggleAll"
                  />
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Product ID
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Reference Name
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Price
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Availability
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <!-- Scrollable body -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <table class="w-full table-fixed">
            <colgroup>
              <col class="w-10" />
              <col class="w-[19%]" />
              <col class="w-[20%]" />
              <col class="w-[15%]" />
              <col class="w-[15%]" />
              <col class="w-[16%]" />
              <col class="w-[12%]" />
            </colgroup>
            <tbody>
              <tr
                v-for="product in filteredProducts"
                :key="product.id"
                class="cursor-pointer border-b border-[#393b40] transition-colors hover:bg-[#2e3038]"
                :class="{ 'bg-blue-600/10': store.selected.has(product.id) }"
                @click="store.setSelectedProduct(product)"
              >
                <td class="px-3 py-3" @click.stop>
                  <input
                    type="checkbox"
                    :checked="store.selected.has(product.id)"
                    class="rounded"
                    @change="store.toggleSelection(product.id)"
                  />
                </td>
                <td class="px-3 py-3 font-mono text-sm text-gray-200">{{ product.productId }}</td>
                <td class="px-3 py-3 text-sm text-gray-300">{{ product.referenceName }}</td>
                <td class="px-3 py-3">
                  <span class="rounded-full bg-[#393b40] px-2 py-0.5 text-xs text-gray-400">
                    {{ typeLabel(product.type) }}
                  </span>
                </td>
                <td class="px-3 py-3 font-mono text-sm text-gray-300">
                  {{ product.basePrice ? `${product.basePrice} ${product.baseCurrency}` : '-' }}
                </td>
                <td class="px-3 py-3">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs"
                    :class="
                      product.territoryCount > 0
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-red-600/20 text-red-400'
                    "
                  >
                    {{ product.territoryCount > 0 ? product.territoryCount + ' 個地區' : '無' }}
                  </span>
                </td>
                <td class="px-3 py-3">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs"
                    :class="
                      product.state === 'APPROVED'
                        ? 'bg-green-600/20 text-green-400'
                        : product.state === 'DEVELOPER_REMOVED_FROM_SALE' ||
                            product.state === 'REMOVED_FROM_SALE'
                          ? 'bg-red-600/20 text-red-400'
                          : 'bg-yellow-600/20 text-yellow-400'
                    "
                  >
                    {{ stateLabel(product.state) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!store.loading && !store.syncing && store.products.length === 0"
        class="py-20 text-center"
      >
        <p class="mb-2 text-lg text-gray-500">尚無商品資料</p>
        <p class="text-sm text-gray-500">請先設定 Apple 憑證，然後點擊「同步商品」</p>
      </div>
      <div
        v-else-if="!store.loading && !store.syncing && filteredProducts.length === 0"
        class="py-10 text-center"
      >
        <p class="text-sm text-gray-500">此狀態下沒有商品</p>
      </div>

      <!-- Loading -->
      <div v-if="store.loading" class="py-20 text-center text-gray-500">載入中...</div>
    </div>

    <!-- Product Detail Modal -->
    <AppleProductDetail
      v-if="store.selectedProduct"
      :project-id="props.projectId"
      @close="store.setSelectedProduct(null)"
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
