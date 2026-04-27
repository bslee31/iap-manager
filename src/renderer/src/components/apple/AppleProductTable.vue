<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import AppleProductDetail from './AppleProductDetail.vue'
import AppleImportDialog from './AppleImportDialog.vue'
import * as appleApi from '../../services/api/apple'
import * as dialogApi from '../../services/api/dialog'
import * as progressApi from '../../services/api/progress'

const props = defineProps<{ projectId: string }>()
const notify = useNotificationStore()

interface AppleProduct {
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

const products = ref<AppleProduct[]>([])
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const syncing = ref(false)
const exporting = ref(false)
const exportProgress = ref('')
const importFileContent = ref<string | null>(null)
const existingProductIds = computed(() => products.value.map((p) => p.productId))
const showCreateForm = ref(false)
const activeFilter = ref<string | null>(null)
const searchQuery = ref('')
const syncProgress = ref('')
const selectedProduct = ref<AppleProduct | null>(null)

// Listen for sync/export progress from main process
let cleanupProgress: (() => void) | null = null
let cleanupExportProgress: (() => void) | null = null
onMounted(() => {
  cleanupProgress = progressApi.onSync((data) => {
    syncProgress.value = data.phase
  })
  cleanupExportProgress = progressApi.onExport((data) => {
    exportProgress.value = data.phase
  })
})
onUnmounted(() => {
  cleanupProgress?.()
  cleanupExportProgress?.()
})

// Create form
const newProduct = ref({
  productId: '',
  referenceName: '',
  inAppPurchaseType: 'CONSUMABLE' as string
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
  for (const p of products.value) {
    counts.set(p.state, (counts.get(p.state) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, label: stateLabel(state), count }))
    .sort((a, b) => (STATUS_ORDER[a.state] ?? 99) - (STATUS_ORDER[b.state] ?? 99))
})

const filteredProducts = computed(() => {
  let result = products.value
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
  return filteredProducts.value.length > 0 && selected.value.size === filteredProducts.value.length
})

const batchActions = [
  { key: 'sync-price', label: '重整 Price' },
  { key: 'sync-availability', label: '重整 Availability' },
  { key: 'activate', label: '批次上架' },
  { key: 'deactivate', label: '批次下架', variant: 'danger' as const }
]

onMounted(loadCached)

async function loadCached() {
  loading.value = true
  const result = await appleApi.getCachedProducts(props.projectId)
  if (result.success) {
    products.value = result.data
  }
  loading.value = false
}

async function syncProducts() {
  syncing.value = true
  syncProgress.value = '正在連線...'
  const result = await appleApi.fetchProducts(props.projectId)
  syncing.value = false
  syncProgress.value = ''
  if (result.success) {
    products.value = result.data
    selected.value.clear()
    notify.success(`同步完成，共 ${result.data.length} 個商品`)
  } else {
    notify.error(result.error || '同步失敗')
  }
}

function onAvailabilityUpdated(count: number) {
  if (selectedProduct.value) {
    selectedProduct.value.territoryCount = count
  }
}

function onPriceUpdated(price: string, currency: string) {
  if (selectedProduct.value) {
    selectedProduct.value.basePrice = price
    selectedProduct.value.baseCurrency = currency
  }
}

function onReferenceNameUpdated(referenceName: string) {
  if (selectedProduct.value) {
    selectedProduct.value.referenceName = referenceName
  }
}

function toggleAll() {
  if (allSelected.value) {
    selected.value.clear()
  } else {
    selected.value = new Set(filteredProducts.value.map((p) => p.id))
  }
}

// Clear the selected Set and reassign to a new instance so reactivity fires
// (Set mutation alone wouldn't trigger reactive updates of dependants).
function clearSelection() {
  selected.value.clear()
  selected.value = new Set()
}

function setFilter(state: string | null) {
  activeFilter.value = activeFilter.value === state ? null : state
  selected.value.clear()
}

function toggleItem(id: string) {
  if (selected.value.has(id)) {
    selected.value.delete(id)
  } else {
    selected.value.add(id)
  }
  // Trigger reactivity
  selected.value = new Set(selected.value)
}

async function handleBatchAction(key: string) {
  const ids = Array.from(selected.value)
  if (ids.length === 0) return

  if (key === 'sync-price') {
    syncing.value = true
    let success = 0
    const total = ids.length
    for (const id of ids) {
      const product = products.value.find((p) => p.id === id)
      if (!product) continue
      syncProgress.value = `重整 Price... ${success + 1}/${total}`
      const result = await appleApi.syncBasePrice(props.projectId, id)
      if (result.success) {
        product.basePrice = result.data.basePrice
        product.baseCurrency = result.data.baseCurrency
        success++
      }
    }
    syncing.value = false
    syncProgress.value = ''
    notify.success(`已重整 ${success} 個商品的價格`)
    return
  }

  if (key === 'sync-availability') {
    syncing.value = true
    let success = 0
    const total = ids.length
    for (const id of ids) {
      const product = products.value.find((p) => p.id === id)
      if (!product) continue
      syncProgress.value = `重整 Availability... ${success + 1}/${total}`
      const result = await appleApi.syncAvailability(props.projectId, id)
      if (result.success) {
        product.territoryCount = result.data.territoryCount
        success++
      }
    }
    syncing.value = false
    syncProgress.value = ''
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
        const errors = data.failed.map((f: any) => `${f.id}: ${f.error}`).join('\n')
        notify.error(`失敗 ${data.failed.length} 項\n${errors}`)
      }
      if (data.success.length > 0) {
        notify.success(`成功${label} ${data.success.length} 項`)
      }
      selected.value.clear()
      await syncProducts()
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
  // Main process has already updated local DB with imported products,
  // so just reload the cached list (no extra Apple API calls).
  await loadCached()
}

async function exportProducts() {
  if (products.value.length === 0) {
    notify.error('沒有可匯出的商品，請先同步')
    return
  }

  // 有勾選就匯出勾選的，沒勾選就匯出全部
  const source =
    selected.value.size > 0
      ? products.value.filter((p) => selected.value.has(p.id))
      : products.value

  const payload = source.map((p) => ({
    id: p.id,
    productId: p.productId,
    referenceName: p.referenceName,
    type: p.type
  }))

  exporting.value = true
  exportProgress.value = '準備匯出...'
  const result = await appleApi.exportProducts(props.projectId, payload)
  exporting.value = false
  exportProgress.value = ''

  if (!result.success) {
    notify.error(result.error || '匯出失敗')
    return
  }

  const data = result.data
  if (data.cancelled) return

  if (data.errors.length > 0) {
    const lines = data.errors.map((e: any) => `${e.productId}: ${e.error}`).join('\n')
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
    appId: '' // Will be filled from credentials in main process
  })

  if (result.success) {
    notify.success('商品已建立')
    showCreateForm.value = false
    newProduct.value = { productId: '', referenceName: '', inAppPurchaseType: 'CONSUMABLE' }
    await syncProducts()
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
          :disabled="syncing"
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          @click="syncProducts"
        >
          同步商品
        </button>
        <button
          :disabled="exporting || syncing || products.length === 0"
          class="rounded-lg border border-[#43454a] px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
          @click="exportProducts"
        >
          匯出
        </button>
        <button
          :disabled="exporting || syncing"
          class="rounded-lg border border-[#43454a] px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
          @click="importProducts"
        >
          匯入
        </button>
        <span v-if="syncing" class="flex items-center gap-2 text-sm text-gray-400">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
          />
          {{ syncProgress }}
        </span>
        <span v-if="exporting" class="flex items-center gap-2 text-sm text-gray-400">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
          />
          {{ exportProgress }}
        </span>
        <span v-if="products.length > 0" class="text-sm whitespace-nowrap text-gray-500">
          {{ filteredProducts.length !== products.length ? `${filteredProducts.length} / ` : ''
          }}{{ products.length }} 個商品
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
    <div v-if="selected.size > 0" class="mb-3 flex shrink-0 items-center gap-3 px-6">
      <span class="text-sm whitespace-nowrap text-gray-300">已選 {{ selected.size }} 項</span>
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
        @click="clearSelection"
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
        全部 {{ products.length }}
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
                :class="{ 'bg-blue-600/10': selected.has(product.id) }"
                @click="selectedProduct = product"
              >
                <td class="px-3 py-3" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selected.has(product.id)"
                    class="rounded"
                    @change="toggleItem(product.id)"
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
      <div v-else-if="!loading && !syncing && products.length === 0" class="py-20 text-center">
        <p class="mb-2 text-lg text-gray-500">尚無商品資料</p>
        <p class="text-sm text-gray-500">請先設定 Apple 憑證，然後點擊「同步商品」</p>
      </div>
      <div
        v-else-if="!loading && !syncing && filteredProducts.length === 0"
        class="py-10 text-center"
      >
        <p class="text-sm text-gray-500">此狀態下沒有商品</p>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="py-20 text-center text-gray-500">載入中...</div>
    </div>

    <!-- Product Detail Modal -->
    <AppleProductDetail
      v-if="selectedProduct"
      :project-id="props.projectId"
      :product="selectedProduct"
      @close="selectedProduct = null"
      @update-availability="onAvailabilityUpdated"
      @update-price="onPriceUpdated"
      @update-reference-name="onReferenceNameUpdated"
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
