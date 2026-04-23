<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import SearchableSelect from '../common/SearchableSelect.vue'
import { GOOGLE_LANGUAGES } from '../../utils/google-languages'
import GoogleProductDetail from './GoogleProductDetail.vue'

const props = defineProps<{ projectId: string }>()
const notify = useNotificationStore()

const languageOptions = GOOGLE_LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
  right: l.code
}))

const projectDefaultLanguage = ref('')
const detectingLanguage = ref(false)
const creating = ref(false)

interface RegionInfo {
  regionCode: string
  currencyCode: string
}
const supportedRegions = ref<RegionInfo[]>([])
const loadingRegions = ref(false)

const regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' })
const regionOptions = computed(() =>
  supportedRegions.value
    .map((r) => ({
      value: r.regionCode,
      label: `${regionDisplayNames.of(r.regionCode) || r.regionCode}`,
      right: `${r.regionCode} · ${r.currencyCode}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
)

function currencyForRegion(regionCode: string): string {
  return supportedRegions.value.find((r) => r.regionCode === regionCode)?.currencyCode || ''
}

interface GoogleProduct {
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

const products = ref<GoogleProduct[]>([])
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const syncing = ref(false)
const showCreateForm = ref(false)
const searchQuery = ref('')
const syncProgress = ref('')
const selectedProduct = ref<GoogleProduct | null>(null)

let cleanupProgress: (() => void) | null = null
onMounted(() => {
  cleanupProgress = window.api.onSyncProgress((data) => {
    syncProgress.value = data.phase
  })
})
onUnmounted(() => {
  cleanupProgress?.()
})

const newProduct = ref({
  productId: '',
  name: '',
  description: '',
  languageCode: '',
  purchaseOptionId: 'base',
  baseRegionCode: '',
  basePrice: ''
})
const activeFilter = ref<string | null>(null)

const STATUS_ORDER: Record<string, number> = {
  ACTIVE: 0,
  DRAFT: 1,
  INACTIVE: 2,
  INACTIVE_PUBLISHED: 3,
  NO_PURCHASE_OPTION: 4
}

const statusGroups = computed(() => {
  const counts = new Map<string, number>()
  for (const p of products.value) {
    counts.set(p.status, (counts.get(p.status) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, label: statusLabel(status), count }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
})

const filteredProducts = computed(() => {
  let result = products.value
  if (activeFilter.value) {
    result = result.filter((p) => p.status === activeFilter.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(
      (p) => p.productId.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    )
  }
  return result
})

function setFilter(status: string | null) {
  activeFilter.value = activeFilter.value === status ? null : status
  selected.value.clear()
}

const allSelected = computed(() => {
  return filteredProducts.value.length > 0 && selected.value.size === filteredProducts.value.length
})

const batchActions = [
  { key: 'activate', label: '批次上架' },
  { key: 'deactivate', label: '批次下架', variant: 'danger' as const }
]

onMounted(async () => {
  await Promise.all([loadCached(), loadProjectSettings()])
})

async function loadProjectSettings() {
  const result = await window.api.getGoogleSettings(props.projectId)
  if (result.success && result.data) {
    projectDefaultLanguage.value = result.data.defaultLanguage || ''
  }
}

async function loadCached() {
  loading.value = true
  const result = await window.api.getCachedGoogleProducts(props.projectId)
  if (result.success) {
    products.value = result.data
  }
  loading.value = false
}

async function openCreateForm() {
  newProduct.value = {
    productId: '',
    name: '',
    description: '',
    languageCode: projectDefaultLanguage.value,
    purchaseOptionId: 'base',
    baseRegionCode: '',
    basePrice: ''
  }
  showCreateForm.value = true
  if (supportedRegions.value.length === 0) {
    loadingRegions.value = true
    const result = await window.api.getGoogleRegions(props.projectId)
    loadingRegions.value = false
    if (result.success && result.data) {
      supportedRegions.value = result.data
    } else {
      notify.error(result.error || '無法取得支援地區')
    }
  }
}

async function detectLanguageInModal() {
  detectingLanguage.value = true
  const result = await window.api.detectGoogleDefaultLanguage(props.projectId)
  detectingLanguage.value = false
  if (result.success && result.data) {
    projectDefaultLanguage.value = result.data.defaultLanguage
    newProduct.value.languageCode = result.data.defaultLanguage
    notify.success(`已偵測到預設語言：${result.data.defaultLanguage}`)
  } else {
    notify.error(result.error || '偵測失敗')
  }
}

async function syncProducts() {
  syncing.value = true
  syncProgress.value = '正在連線...'
  const result = await window.api.fetchGoogleProducts(props.projectId)
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

function toggleAll() {
  if (allSelected.value) {
    selected.value.clear()
  } else {
    selected.value = new Set(filteredProducts.value.map((p) => p.productId))
  }
}

function toggleItem(id: string) {
  if (selected.value.has(id)) {
    selected.value.delete(id)
  } else {
    selected.value.add(id)
  }
  selected.value = new Set(selected.value)
}

async function handleBatchAction(key: string) {
  const ids = Array.from(selected.value)
  if (ids.length === 0) return

  if (key === 'activate' || key === 'deactivate') {
    const active = key === 'activate'
    const label = active ? '上架' : '下架'

    if (!confirm(`確定要${label}選取的 ${ids.length} 個商品嗎？`)) return

    notify.info(`正在批次${label}...`)
    const plainProducts = JSON.parse(JSON.stringify(products.value))
    const result = await window.api.batchUpdateGoogleStatus(props.projectId, ids, active, plainProducts)
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

function parsePriceToUnitsNanos(input: string): { units: string; nanos: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [intPart, fracPart = ''] = trimmed.split('.')
  const paddedFrac = (fracPart + '000000000').slice(0, 9)
  return { units: intPart, nanos: Number(paddedFrac) }
}

async function createProduct() {
  if (!newProduct.value.productId || !newProduct.value.name) {
    notify.error('請填寫商品 ID 和名稱')
    return
  }
  if (!newProduct.value.languageCode) {
    notify.error('請選擇語言')
    return
  }
  if (!newProduct.value.baseRegionCode) {
    notify.error('請選擇基準國家')
    return
  }
  const baseCurrency = currencyForRegion(newProduct.value.baseRegionCode)
  if (!baseCurrency) {
    notify.error('找不到該國家的幣別')
    return
  }
  const parsed = parsePriceToUnitsNanos(newProduct.value.basePrice)
  if (!parsed) {
    notify.error('請輸入有效的基準價格')
    return
  }
  if (!newProduct.value.purchaseOptionId.trim()) {
    notify.error('請填寫 Purchase Option ID')
    return
  }

  creating.value = true
  const result = await window.api.createGoogleProduct(props.projectId, {
    productId: newProduct.value.productId,
    name: newProduct.value.name,
    description: newProduct.value.description,
    languageCode: newProduct.value.languageCode,
    purchaseOptionId: newProduct.value.purchaseOptionId.trim(),
    baseRegionCode: newProduct.value.baseRegionCode,
    baseCurrencyCode: baseCurrency,
    basePriceUnits: parsed.units,
    basePriceNanos: parsed.nanos
  })
  creating.value = false
  if (result.success) {
    const skipped = (result as any).skippedRegions as string[] | undefined
    if (skipped && skipped.length > 0) {
      notify.success(`商品已建立（草稿）。略過 ${skipped.length} 個地區：${skipped.join(', ')}（可到 Play Console 手動設定）`)
    } else {
      notify.success('商品已建立（草稿）')
    }
    showCreateForm.value = false
    newProduct.value = {
      productId: '',
      name: '',
      description: '',
      languageCode: projectDefaultLanguage.value,
      purchaseOptionId: 'base',
      baseRegionCode: '',
      basePrice: ''
    }
    await syncProducts()
  } else {
    notify.error(result.error || '建立失敗')
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: '上架中',
    INACTIVE: '已下架',
    INACTIVE_PUBLISHED: '已下架（保留）',
    DRAFT: '草稿',
    NO_PURCHASE_OPTION: '未設定方案'
  }
  return map[status] || status
}

function productStatusLabel(product: GoogleProduct): string {
  const total = product.purchaseOptionCount ?? 0
  const active = product.activePurchaseOptionCount ?? 0
  // Only show the split when states are actually mixed; uniform states fall
  // back to the aggregated label to avoid noisy "0/2" or "2/2" displays.
  if (total > 1 && active > 0 && active < total) {
    return `${active}/${total} 上架中`
  }
  return statusLabel(product.status)
}

function productPriceLabel(product: GoogleProduct): string {
  if (!product.basePrice || !product.baseCurrency) return '-'
  // Format matches the Apple table: amount then currency (e.g. "200.00 TWD").
  return `${product.basePrice} ${product.baseCurrency}`
}

function statusColor(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'bg-green-600/20 text-green-400'
    case 'INACTIVE':
    case 'INACTIVE_PUBLISHED': return 'bg-red-600/20 text-red-400'
    case 'DRAFT': return 'bg-yellow-600/20 text-yellow-400'
    default: return 'bg-[#393b40] text-gray-400'
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center justify-between mb-4 px-6 pt-6 shrink-0">
      <div class="flex gap-2 items-center">
        <button
          @click="syncProducts"
          :disabled="syncing"
          class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          同步商品
        </button>
        <span v-if="syncing" class="text-sm text-gray-400 flex items-center gap-2">
          <span class="inline-block w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
          {{ syncProgress }}
        </span>
        <span v-if="products.length > 0" class="text-sm text-gray-500 whitespace-nowrap">
          {{ filteredProducts.length !== products.length ? `${filteredProducts.length} / ` : '' }}{{ products.length }} 個商品
        </span>
      </div>
      <div class="flex items-center gap-3">
        <input
          v-model="searchQuery"
          type="text"
          class="px-3 py-1.5 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500 w-52"
          placeholder="搜尋 Product ID / Name..."
        />
        <button
          @click="openCreateForm"
          class="px-4 py-2 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors whitespace-nowrap"
        >
          + 新增商品
        </button>
      </div>
    </div>

    <!-- Batch Action Bar (inline) -->
    <div v-if="selected.size > 0" class="flex items-center gap-3 px-6 mb-3 shrink-0">
      <span class="text-sm text-gray-300 whitespace-nowrap">已選 {{ selected.size }} 項</span>
      <div class="w-px h-5 bg-[#43454a]" />
      <button
        v-for="action in batchActions"
        :key="action.key"
        @click="handleBatchAction(action.key)"
        class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
        :class="action.variant === 'danger'
          ? 'bg-red-600 hover:bg-red-700 text-white'
          : 'bg-green-600 hover:bg-green-700 text-white'"
      >
        {{ action.label }}
      </button>
      <button
        @click="selected.clear(); selected = new Set()"
        class="text-gray-400 hover:text-white text-sm transition-colors whitespace-nowrap"
      >
        取消選取
      </button>
    </div>

    <!-- Status filter chips -->
    <div v-if="statusGroups.length > 0" class="flex flex-wrap gap-2 mb-4 px-6 shrink-0">
      <button
        @click="setFilter(null)"
        class="px-3 py-1 rounded-full text-xs font-medium transition-colors"
        :class="activeFilter === null
          ? 'bg-green-600 text-white'
          : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'"
      >
        全部 {{ products.length }}
      </button>
      <button
        v-for="group in statusGroups"
        :key="group.status"
        @click="setFilter(group.status)"
        class="px-3 py-1 rounded-full text-xs font-medium transition-colors"
        :class="activeFilter === group.status
          ? 'bg-green-600 text-white'
          : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'"
      >
        {{ group.label }} {{ group.count }}
      </button>
    </div>

    <!-- Create Form Modal -->
    <div v-if="showCreateForm" class="fixed inset-0 bg-black/60 flex items-center justify-center z-40" @click.self="showCreateForm = false">
      <div class="bg-[#2b2d30] rounded-xl shadow-xl w-full max-w-md border border-[#393b40] titlebar-no-drag flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h3 class="text-lg font-semibold text-gray-100">新增 Google 商品</h3>
          <button @click="showCreateForm = false" class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors">&times;</button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-2 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">Product ID</label>
            <input
              v-model="newProduct.productId"
              type="text"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
              placeholder="例：coins_100"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">語言</label>
            <div class="flex items-center gap-2">
              <div class="flex-1">
                <SearchableSelect
                  v-model="newProduct.languageCode"
                  :options="languageOptions"
                  placeholder="請選擇語言"
                />
              </div>
              <button
                @click="detectLanguageInModal"
                :disabled="detectingLanguage"
                class="px-3 py-1.5 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {{ detectingLanguage ? '偵測中...' : '偵測' }}
              </button>
            </div>
            <p class="text-xs text-gray-500 mt-1">
              按「偵測」會從 Play Console 讀取並設為專案預設；手動選擇則只影響此次建立。
            </p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">名稱</label>
            <input
              v-model="newProduct.name"
              type="text"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
              placeholder="例：100 金幣"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">描述</label>
            <textarea
              v-model="newProduct.description"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
              rows="3"
              placeholder="商品描述"
            />
          </div>

          <div class="border-t border-[#393b40] pt-4">
            <div class="text-xs text-gray-500 mb-3">方案設定（建立為草稿狀態，需到 Play Console 再上架）</div>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">Purchase Option ID</label>
                <input
                  v-model="newProduct.purchaseOptionId"
                  type="text"
                  class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
                  placeholder="例：base"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">Purchase type</label>
                <select
                  class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="BUY" selected>Buy</option>
                  <option value="RENT" disabled>Rent（尚未支援）</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">
                  基準國家
                  <span v-if="loadingRegions" class="text-xs text-gray-500 font-normal ml-1">載入中...</span>
                </label>
                <SearchableSelect
                  v-model="newProduct.baseRegionCode"
                  :options="regionOptions"
                  placeholder="請選擇基準國家"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">基準價格</label>
                <div class="flex items-center gap-2">
                  <input
                    v-model="newProduct.basePrice"
                    type="text"
                    inputmode="decimal"
                    class="flex-1 px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
                    placeholder="例：30"
                  />
                  <span class="px-3 py-2 text-sm text-gray-300 bg-[#22252a] border border-[#43454a] rounded-lg min-w-[4rem] text-center">
                    {{ currencyForRegion(newProduct.baseRegionCode) || '---' }}
                  </span>
                </div>
                <p class="text-xs text-gray-500 mt-1">其他國家的價格會由 Google 依基準價自動換算。</p>
                <p class="text-xs text-yellow-500/80 mt-1">
                  ⚠ 此價格為未稅價。Google 會依各國稅率自動加稅（例如台灣 +5%）顯示給使用者。若要「含稅最終價」，請自行反算後再輸入。
                </p>
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 shrink-0 border-t border-[#393b40]">
          <button
            @click="showCreateForm = false"
            :disabled="creating"
            class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            @click="createProduct"
            :disabled="creating"
            class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {{ creating ? '建立中...' : '建立' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Product Table -->
    <div class="flex-1 min-h-0 px-6 pb-6">
    <div v-if="filteredProducts.length > 0" class="bg-[#2b2d30] rounded-xl border border-[#393b40] overflow-hidden h-full flex flex-col">
      <!-- Fixed header -->
      <div class="shrink-0" style="scrollbar-gutter: stable">
      <table class="w-full table-fixed">
        <colgroup>
          <col class="w-10" />
          <col class="w-[30%]" />
          <col class="w-[35%]" />
          <col class="w-[17%]" />
          <col class="w-[18%]" />
        </colgroup>
        <thead>
          <tr class="bg-[#22252a] border-b border-[#393b40]">
            <th class="px-3 py-3">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" class="rounded" />
            </th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Product ID</th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Product name</th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Price</th>
            <th class="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
      </table>
      </div>
      <!-- Scrollable body -->
      <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable">
      <table class="w-full table-fixed">
        <colgroup>
          <col class="w-10" />
          <col class="w-[30%]" />
          <col class="w-[35%]" />
          <col class="w-[17%]" />
          <col class="w-[18%]" />
        </colgroup>
        <tbody>
          <tr
            v-for="product in filteredProducts"
            :key="product.productId"
            @click="selectedProduct = product"
            class="border-b border-[#393b40] hover:bg-[#2e3038] transition-colors cursor-pointer"
            :class="{ 'bg-green-600/10': selected.has(product.productId) }"
          >
            <td class="w-10 px-3 py-3" @click.stop>
              <input
                type="checkbox"
                :checked="selected.has(product.productId)"
                @change="toggleItem(product.productId)"
                class="rounded"
              />
            </td>
            <td class="px-3 py-3 text-sm font-mono text-gray-200">{{ product.productId }}</td>
            <td class="px-3 py-3 text-sm text-gray-300">{{ product.name }}</td>
            <td class="px-3 py-3 text-sm text-gray-300 font-mono">{{ productPriceLabel(product) }}</td>
            <td class="px-3 py-3">
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                :class="statusColor(product.status)"
              >
                {{ productStatusLabel(product) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!loading && !syncing && products.length === 0" class="text-center py-20">
      <p class="text-gray-500 text-lg mb-2">尚無商品資料</p>
      <p class="text-gray-500 text-sm">請先設定 Google 憑證，然後點擊「同步商品」</p>
    </div>
    <div v-else-if="!loading && !syncing && filteredProducts.length === 0" class="text-center py-10">
      <p class="text-gray-500 text-sm">此狀態下沒有商品</p>
    </div>

    <div v-if="loading" class="text-center py-20 text-gray-500">載入中...</div>
    </div>

    <!-- Product Detail Modal -->
    <GoogleProductDetail
      v-if="selectedProduct"
      :project-id="projectId"
      :product="selectedProduct"
      @close="selectedProduct = null"
      @updated="syncProducts"
    />
  </div>
</template>
