<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import SearchableSelect from '../common/SearchableSelect.vue'
import { GOOGLE_LANGUAGES } from '../../utils/google-languages'
import GoogleProductDetail from './GoogleProductDetail.vue'
import GoogleImportDialog from './GoogleImportDialog.vue'
import * as googleApi from '../../services/api/google'
import * as dialogApi from '../../services/api/dialog'
import * as progressApi from '../../services/api/progress'

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
const exporting = ref(false)
const exportProgress = ref('')
const importFileContent = ref<string | null>(null)
const showCreateForm = ref(false)
const searchQuery = ref('')
const syncProgress = ref('')
const selectedProduct = ref<GoogleProduct | null>(null)

const existingProductIds = computed(() => products.value.map((p) => p.productId))

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
  const result = await googleApi.getSettings(props.projectId)
  if (result.success && result.data) {
    projectDefaultLanguage.value = result.data.defaultLanguage || ''
  }
}

async function loadCached() {
  loading.value = true
  const result = await googleApi.getCachedProducts(props.projectId)
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
    const result = await googleApi.getRegions(props.projectId)
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
  const result = await googleApi.detectDefaultLanguage(props.projectId)
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
  const result = await googleApi.fetchProducts(props.projectId)
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

async function importProducts() {
  const result = await dialogApi.importFile([{ name: 'JSON', extensions: ['json'] }])
  if (!result.success || !result.data) return
  importFileContent.value = result.data
}

async function onImportDone() {
  importFileContent.value = null
  // Re-sync so the list reflects the newly created products (and their
  // status / price via the usual listOneTimeProducts aggregation).
  await syncProducts()
}

async function exportProducts() {
  if (products.value.length === 0) {
    notify.error('沒有可匯出的商品，請先同步')
    return
  }

  // Export selected if any, otherwise all — mirrors the Apple table.
  const source =
    selected.value.size > 0
      ? products.value.filter((p) => selected.value.has(p.productId))
      : products.value

  const payload = source.map((p) => ({ productId: p.productId }))

  exporting.value = true
  exportProgress.value = '準備匯出...'
  const result = await googleApi.exportProducts(props.projectId, payload)
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

function toggleAll() {
  if (allSelected.value) {
    selected.value.clear()
  } else {
    selected.value = new Set(filteredProducts.value.map((p) => p.productId))
  }
}

// Clear the selected Set and reassign to a new instance so reactivity fires
// (Set mutation alone wouldn't trigger reactive updates of dependants).
function clearSelection() {
  selected.value.clear()
  selected.value = new Set()
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
    const result = await googleApi.batchUpdateStatus(props.projectId, ids, active, plainProducts)
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
  if (!/^[a-z0-9][a-z0-9._]*$/.test(newProduct.value.productId)) {
    notify.error('Product ID 必須以小寫英數開頭，只能含小寫英數、_、.')
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
  const poid = newProduct.value.purchaseOptionId.trim()
  if (!poid) {
    notify.error('請填寫 Purchase Option ID')
    return
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(poid)) {
    notify.error('Purchase Option ID 必須以小寫英數開頭，只能含小寫英數和 -')
    return
  }

  creating.value = true
  const result = await googleApi.createProduct(props.projectId, {
    productId: newProduct.value.productId,
    name: newProduct.value.name,
    description: newProduct.value.description,
    languageCode: newProduct.value.languageCode,
    purchaseOptionId: poid,
    baseRegionCode: newProduct.value.baseRegionCode,
    baseCurrencyCode: baseCurrency,
    basePriceUnits: parsed.units,
    basePriceNanos: parsed.nanos
  })
  creating.value = false
  if (result.success) {
    const skipped = (result as any).skippedRegions as string[] | undefined
    if (skipped && skipped.length > 0) {
      notify.success(
        `商品已建立（草稿）。略過 ${skipped.length} 個地區：${skipped.join(', ')}（可到 Play Console 手動設定）`
      )
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
    case 'ACTIVE':
      return 'bg-green-600/20 text-green-400'
    case 'INACTIVE':
    case 'INACTIVE_PUBLISHED':
      return 'bg-red-600/20 text-red-400'
    case 'DRAFT':
      return 'bg-yellow-600/20 text-yellow-400'
    default:
      return 'bg-[#393b40] text-gray-400'
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="mb-4 flex shrink-0 items-center justify-between px-6 pt-6">
      <div class="flex items-center gap-2">
        <button
          :disabled="syncing"
          class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
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
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-400 border-t-transparent"
          />
          {{ syncProgress }}
        </span>
        <span v-if="exporting" class="flex items-center gap-2 text-sm text-gray-400">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-400 border-t-transparent"
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
          class="w-52 rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
          placeholder="搜尋 Product ID / Name..."
        />
        <button
          class="rounded-lg border border-[#43454a] px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40]"
          @click="openCreateForm"
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
            : 'bg-green-600 text-white hover:bg-green-700'
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
            ? 'bg-green-600 text-white'
            : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'
        "
        @click="setFilter(null)"
      >
        全部 {{ products.length }}
      </button>
      <button
        v-for="group in statusGroups"
        :key="group.status"
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
        :class="
          activeFilter === group.status
            ? 'bg-green-600 text-white'
            : 'bg-[#2b2d30] text-gray-400 hover:bg-[#393b40]'
        "
        @click="setFilter(group.status)"
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
        class="titlebar-no-drag flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-[#393b40] bg-[#2b2d30] shadow-xl"
      >
        <div class="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h3 class="text-lg font-semibold text-gray-100">新增 Google 商品</h3>
          <button
            class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
            @click="showCreateForm = false"
          >
            &times;
          </button>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">Product ID</label>
            <input
              v-model="newProduct.productId"
              type="text"
              maxlength="139"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
              placeholder="例：coins_100"
            />
            <p class="mt-1 text-xs text-gray-500">
              以小寫英數開頭，只能含小寫英數、_、.；建立後無法修改
            </p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">語言</label>
            <div class="flex items-center gap-2">
              <div class="flex-1">
                <SearchableSelect
                  v-model="newProduct.languageCode"
                  :options="languageOptions"
                  placeholder="請選擇語言"
                />
              </div>
              <button
                :disabled="detectingLanguage"
                class="rounded-lg border border-[#43454a] px-3 py-1.5 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
                @click="detectLanguageInModal"
              >
                {{ detectingLanguage ? '偵測中...' : '偵測' }}
              </button>
            </div>
            <p class="mt-1 text-xs text-gray-500">
              按「偵測」會從 Play Console 讀取並設為專案預設；手動選擇則只影響此次建立。
            </p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">名稱</label>
            <input
              v-model="newProduct.name"
              type="text"
              maxlength="55"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
              placeholder="例：100 金幣"
            />
            <p class="mt-1 text-right text-xs text-gray-500">{{ newProduct.name.length }} / 55</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">描述</label>
            <textarea
              v-model="newProduct.description"
              maxlength="200"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
              rows="3"
              placeholder="商品描述"
            />
            <p class="mt-1 text-right text-xs text-gray-500">
              {{ newProduct.description.length }} / 200
            </p>
          </div>

          <div class="border-t border-[#393b40] pt-4">
            <div class="mb-3 text-xs text-gray-500">
              方案設定（建立為草稿狀態，需到 Play Console 再上架）
            </div>
            <div class="space-y-4">
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400"
                  >Purchase Option ID</label
                >
                <input
                  v-model="newProduct.purchaseOptionId"
                  type="text"
                  maxlength="63"
                  class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 font-mono text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
                  placeholder="例：base"
                />
                <p class="mt-1 text-xs text-gray-500">
                  以小寫英數開頭，只能含小寫英數和 -（不可有 _ 或 .）
                </p>
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400">Purchase type</label>
                <select
                  class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-green-500 focus:outline-none"
                >
                  <option value="BUY" selected>Buy</option>
                  <option value="RENT" disabled>Rent（尚未支援）</option>
                </select>
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400">
                  基準國家
                  <span v-if="loadingRegions" class="ml-1 text-xs font-normal text-gray-500"
                    >載入中...</span
                  >
                </label>
                <SearchableSelect
                  v-model="newProduct.baseRegionCode"
                  :options="regionOptions"
                  placeholder="請選擇基準國家"
                />
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400">基準價格</label>
                <div class="flex items-center gap-2">
                  <input
                    v-model="newProduct.basePrice"
                    type="text"
                    inputmode="decimal"
                    class="flex-1 rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
                    placeholder="例：30"
                  />
                  <span
                    class="min-w-[4rem] rounded-lg border border-[#43454a] bg-[#22252a] px-3 py-2 text-center text-sm text-gray-300"
                  >
                    {{ currencyForRegion(newProduct.baseRegionCode) || '---' }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-gray-500">
                  其他國家的價格會由 Google 依基準價自動換算。
                </p>
              </div>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 justify-end gap-2 border-t border-[#393b40] px-6 py-4">
          <button
            :disabled="creating"
            class="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-[#393b40] disabled:opacity-50"
            @click="showCreateForm = false"
          >
            取消
          </button>
          <button
            :disabled="creating"
            class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            @click="createProduct"
          >
            {{ creating ? '建立中...' : '建立' }}
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
                  Product name
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Price
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <!-- Scrollable body -->
        <div class="min-h-0 flex-1 overflow-y-auto" style="scrollbar-gutter: stable">
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
                class="cursor-pointer border-b border-[#393b40] transition-colors hover:bg-[#2e3038]"
                :class="{ 'bg-green-600/10': selected.has(product.productId) }"
                @click="selectedProduct = product"
              >
                <td class="w-10 px-3 py-3" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selected.has(product.productId)"
                    class="rounded"
                    @change="toggleItem(product.productId)"
                  />
                </td>
                <td class="px-3 py-3 font-mono text-sm text-gray-200">{{ product.productId }}</td>
                <td class="px-3 py-3 text-sm text-gray-300">{{ product.name }}</td>
                <td class="px-3 py-3 font-mono text-sm text-gray-300">
                  {{ productPriceLabel(product) }}
                </td>
                <td class="px-3 py-3">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs"
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
      <div v-else-if="!loading && !syncing && products.length === 0" class="py-20 text-center">
        <p class="mb-2 text-lg text-gray-500">尚無商品資料</p>
        <p class="text-sm text-gray-500">請先設定 Google 憑證，然後點擊「同步商品」</p>
      </div>
      <div
        v-else-if="!loading && !syncing && filteredProducts.length === 0"
        class="py-10 text-center"
      >
        <p class="text-sm text-gray-500">此狀態下沒有商品</p>
      </div>

      <div v-if="loading" class="py-20 text-center text-gray-500">載入中...</div>
    </div>

    <!-- Product Detail Modal -->
    <GoogleProductDetail
      v-if="selectedProduct"
      :project-id="projectId"
      :product="selectedProduct"
      @close="selectedProduct = null"
      @updated="syncProducts"
    />

    <!-- Import Dialog -->
    <GoogleImportDialog
      v-if="importFileContent !== null"
      :project-id="projectId"
      :file-content="importFileContent"
      :existing-product-ids="existingProductIds"
      @close="importFileContent = null"
      @imported="onImportDone"
    />
  </div>
</template>
