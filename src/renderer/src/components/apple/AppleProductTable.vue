<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import BatchActionBar from '../common/BatchActionBar.vue'

const props = defineProps<{ projectId: string }>()
const notify = useNotificationStore()

interface AppleProduct {
  id: string
  productId: string
  referenceName: string
  type: string
  state: string
  territoryCount: number
  syncedAt: string
}

const products = ref<AppleProduct[]>([])
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const syncing = ref(false)
const showCreateForm = ref(false)
const activeFilter = ref<string | null>(null)
const searchQuery = ref('')
const syncProgress = ref('')
const syncingItem = ref<string | null>(null)

// Listen for sync progress from main process
let cleanupProgress: (() => void) | null = null
onMounted(() => {
  cleanupProgress = window.api.onSyncProgress((data) => {
    syncProgress.value = data.phase
  })
})
onUnmounted(() => {
  cleanupProgress?.()
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
  { key: 'activate', label: '批次上架' },
  { key: 'deactivate', label: '批次下架', variant: 'danger' as const }
]

onMounted(loadCached)

async function loadCached() {
  loading.value = true
  const result = await window.api.getCachedAppleProducts(props.projectId)
  if (result.success) {
    products.value = result.data
  }
  loading.value = false
}

async function syncProducts() {
  syncing.value = true
  syncProgress.value = '正在連線...'
  const result = await window.api.fetchAppleProducts(props.projectId)
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

async function syncSingleAvailability(product: AppleProduct) {
  syncingItem.value = product.id
  const result = await window.api.syncAppleAvailability(props.projectId, product.id)
  syncingItem.value = null
  if (result.success) {
    product.territoryCount = result.data.territoryCount
    notify.success(`${product.productId}: ${result.data.territoryCount} 個地區`)
  } else {
    notify.error(result.error || '同步失敗')
  }
}

function toggleAll() {
  if (allSelected.value) {
    selected.value.clear()
  } else {
    selected.value = new Set(filteredProducts.value.map((p) => p.id))
  }
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

  if (key === 'activate' || key === 'deactivate') {
    const available = key === 'activate'
    const label = available ? '上架' : '下架'

    if (!confirm(`確定要${label}選取的 ${ids.length} 個商品嗎？`)) return

    notify.info(`正在批次${label}...`)
    const result = await window.api.batchUpdateAppleAvailability(
      props.projectId,
      ids,
      available
    )
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

async function createProduct() {
  if (!newProduct.value.productId || !newProduct.value.referenceName) {
    notify.error('請填寫商品 ID 和名稱')
    return
  }

  const result = await window.api.createAppleProduct(props.projectId, {
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
  <div>
    <!-- Toolbar -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex gap-2">
        <button
          @click="syncProducts"
          :disabled="syncing"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          同步商品
        </button>
        <span v-if="syncing" class="text-sm text-gray-400 flex items-center gap-2">
          <span class="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          {{ syncProgress }}
        </span>
        <button
          @click="showCreateForm = true"
          class="px-4 py-2 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors"
        >
          + 新增商品
        </button>
      </div>
      <div class="flex items-center gap-3">
        <input
          v-model="searchQuery"
          type="text"
          class="px-3 py-1.5 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 w-52"
          placeholder="搜尋 Product ID / Name..."
        />
        <span v-if="products.length > 0" class="text-sm text-gray-500 whitespace-nowrap">
          {{ filteredProducts.length !== products.length ? `${filteredProducts.length} / ` : '' }}{{ products.length }} 個商品
        </span>
      </div>
    </div>

    <!-- Status filter chips -->
    <div v-if="statusGroups.length > 0" class="flex flex-wrap gap-2 mb-4">
      <button
        @click="setFilter(null)"
        class="px-3 py-1 rounded-full text-xs font-medium transition-colors"
        :class="activeFilter === null
          ? 'bg-blue-600 text-white'
          : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'"
      >
        全部 {{ products.length }}
      </button>
      <button
        v-for="group in statusGroups"
        :key="group.state"
        @click="setFilter(group.state)"
        class="px-3 py-1 rounded-full text-xs font-medium transition-colors"
        :class="activeFilter === group.state
          ? 'bg-blue-600 text-white'
          : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'"
      >
        {{ group.label }} {{ group.count }}
      </button>
    </div>

    <!-- Create Form Modal -->
    <div v-if="showCreateForm" class="fixed inset-0 bg-black/60 flex items-center justify-center z-40">
      <div class="bg-[#2b2d30] rounded-xl shadow-xl p-6 w-full max-w-md border border-[#393b40]">
        <h3 class="text-lg font-semibold mb-4 text-gray-100">新增 Apple IAP</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">Product ID</label>
            <input
              v-model="newProduct.productId"
              type="text"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              placeholder="例：com.example.coins100"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">Reference Name</label>
            <input
              v-model="newProduct.referenceName"
              type="text"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              placeholder="例：100 金幣"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">類型</label>
            <select
              v-model="newProduct.inAppPurchaseType"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="CONSUMABLE">消耗型</option>
              <option value="NON_CONSUMABLE">非消耗型</option>
              <option value="NON_RENEWING_SUBSCRIPTION">非續訂型訂閱</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button @click="showCreateForm = false" class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors">
            取消
          </button>
          <button @click="createProduct" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors">
            建立
          </button>
        </div>
      </div>
    </div>

    <!-- Product Table -->
    <div v-if="filteredProducts.length > 0" class="bg-[#2b2d30] rounded-xl border border-[#393b40] overflow-hidden">
      <table class="w-full">
        <thead>
          <tr class="bg-[#22252a] border-b border-[#393b40]">
            <th class="w-10 px-3 py-3">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" class="rounded" />
            </th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Product ID</th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Reference Name</th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Availability</th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="product in filteredProducts"
            :key="product.id"
            class="border-b border-[#393b40] hover:bg-[#2e3038] transition-colors"
            :class="{ 'bg-blue-600/10': selected.has(product.id) }"
          >
            <td class="px-3 py-3">
              <input
                type="checkbox"
                :checked="selected.has(product.id)"
                @change="toggleItem(product.id)"
                class="rounded"
              />
            </td>
            <td class="px-3 py-3 text-sm font-mono text-gray-200">{{ product.productId }}</td>
            <td class="px-3 py-3 text-sm text-gray-300">{{ product.referenceName }}</td>
            <td class="px-3 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full bg-[#393b40] text-gray-400">
                {{ typeLabel(product.type) }}
              </span>
            </td>
            <td class="px-3 py-3">
              <div class="flex items-center gap-1.5">
                <span
                  class="text-xs px-2 py-0.5 rounded-full"
                  :class="product.territoryCount > 0
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'bg-red-600/20 text-red-400'"
                >
                  {{ product.territoryCount > 0 ? product.territoryCount + ' 個地區' : '無' }}
                </span>
                <button
                  @click.stop="syncSingleAvailability(product)"
                  :disabled="syncingItem === product.id"
                  class="p-0.5 text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                  title="重新同步 Availability"
                >
                  <span
                    class="inline-block text-xs leading-none"
                    :class="{ 'animate-spin': syncingItem === product.id }"
                  >&#8635;</span>
                </button>
              </div>
            </td>
            <td class="px-3 py-3">
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                :class="product.state === 'APPROVED'
                  ? 'bg-green-600/20 text-green-400'
                  : product.state === 'DEVELOPER_REMOVED_FROM_SALE' || product.state === 'REMOVED_FROM_SALE'
                    ? 'bg-red-600/20 text-red-400'
                    : 'bg-yellow-600/20 text-yellow-400'"
              >
                {{ stateLabel(product.state) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty state -->
    <div v-else-if="!loading && !syncing && products.length === 0" class="text-center py-20">
      <p class="text-gray-500 text-lg mb-2">尚無商品資料</p>
      <p class="text-gray-500 text-sm">請先設定 Apple 憑證，然後點擊「同步商品」</p>
    </div>
    <div v-else-if="!loading && !syncing && filteredProducts.length === 0" class="text-center py-10">
      <p class="text-gray-500 text-sm">此狀態下沒有商品</p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-20 text-gray-500">
      載入中...
    </div>

    <!-- Batch Action Bar -->
    <BatchActionBar
      :count="selected.size"
      :actions="batchActions"
      @action="handleBatchAction"
      @clear="selected.clear(); selected = new Set()"
    />
  </div>
</template>
