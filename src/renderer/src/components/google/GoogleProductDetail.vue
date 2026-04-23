<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import SearchableSelect from '../common/SearchableSelect.vue'
import { GOOGLE_LANGUAGES, getLanguageLabel } from '../../utils/google-languages'

const props = defineProps<{
  projectId: string
  product: {
    productId: string
    name: string
    description: string
    status: string
  }
}>()

const emit = defineEmits<{
  close: []
  updated: []
}>()
const notify = useNotificationStore()

type Tab = 'info' | 'purchaseOptions' | 'pricing' | 'listings'
const activeTab = ref<Tab>('info')

interface Listing {
  languageCode: string
  title: string
  description: string
}
interface RegionalConfig {
  regionCode: string
  availability: string
  price?: { currencyCode: string; units: string; nanos: number }
}
interface PurchaseOption {
  purchaseOptionId: string
  state: string
  type: 'BUY' | 'RENT' | 'UNKNOWN'
  legacyCompatible: boolean
  regionalConfigs: RegionalConfig[]
}
interface ProductDetail {
  productId: string
  listings: Listing[]
  purchaseOptions: PurchaseOption[]
}

const detail = ref<ProductDetail | null>(null)
const loading = ref(false)
const baseRegion = ref<string>('')

// Derive status from the freshly loaded detail so toggling a PO state
// updates the Info tab without waiting for a parent re-render. Uses the same
// priority-based aggregation as the list backend for consistency:
// ACTIVE > INACTIVE/INACTIVE_PUBLISHED > DRAFT > NO_PURCHASE_OPTION.
const derivedStatus = computed(() => {
  const pos = detail.value?.purchaseOptions || []
  if (pos.length === 0) return 'NO_PURCHASE_OPTION'
  if (pos.some((po) => po.state === 'ACTIVE')) return 'ACTIVE'
  if (pos.some((po) => po.state === 'INACTIVE' || po.state === 'INACTIVE_PUBLISHED')) {
    return 'INACTIVE'
  }
  return 'DRAFT'
})
const derivedStatusLabel = computed(() => {
  const pos = detail.value?.purchaseOptions || []
  const total = pos.length
  const active = pos.filter((po) => po.state === 'ACTIVE').length
  if (total > 1 && active > 0 && active < total) {
    return `${active}/${total} 上架中`
  }
  return statusLabel(derivedStatus.value)
})

interface RegionInfo {
  regionCode: string
  currencyCode: string
}
const supportedRegions = ref<RegionInfo[]>([])
const regionOptionsForEdit = computed(() =>
  supportedRegions.value
    .map((r) => ({
      value: r.regionCode,
      label: regionDisplay.of(r.regionCode) || r.regionCode,
      right: `${r.regionCode} · ${r.currencyCode}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
)
function currencyForRegion(code: string): string {
  return supportedRegions.value.find((r) => r.regionCode === code)?.currencyCode || ''
}

// Derive a region code from a BCP-47 language tag (e.g. "zh-TW" -> "TW").
// Falls back to empty string when the tag has no country suffix.
function inferRegionFromLanguage(lang: string | null): string {
  if (!lang) return ''
  const parts = lang.split('-')
  const last = parts[parts.length - 1]
  return last.length === 2 ? last.toUpperCase() : ''
}

async function loadDetail() {
  loading.value = true
  const [detailResult, settingsResult, regionsResult] = await Promise.all([
    window.api.getGoogleProductDetail(props.projectId, props.product.productId),
    window.api.getGoogleSettings(props.projectId),
    window.api.getGoogleRegions(props.projectId)
  ])
  loading.value = false
  if (detailResult.success && detailResult.data) {
    detail.value = detailResult.data
    if (detail.value && detail.value.purchaseOptions.length > 0) {
      selectedPoId.value = detail.value.purchaseOptions[0].purchaseOptionId
    }
  } else {
    notify.error(detailResult.error || '載入失敗')
  }
  if (settingsResult.success && settingsResult.data) {
    baseRegion.value =
      settingsResult.data.baseRegion ||
      inferRegionFromLanguage(settingsResult.data.defaultLanguage)
  }
  if (regionsResult.success && regionsResult.data) {
    supportedRegions.value = regionsResult.data
  }
}

onMounted(loadDetail)

// ── Pricing: purchase option selection ──
const selectedPoId = ref('')
const poOptions = computed(() =>
  (detail.value?.purchaseOptions || []).map((po) => ({
    value: po.purchaseOptionId,
    label: `${po.purchaseOptionId}`,
    right: `${po.type} · ${po.state}`
  }))
)
const selectedPo = computed(() =>
  detail.value?.purchaseOptions.find((po) => po.purchaseOptionId === selectedPoId.value) || null
)

const regionDisplay = new Intl.DisplayNames(['en'], { type: 'region' })
function regionLabel(code: string): string {
  return regionDisplay.of(code) || code
}

const regionSearch = ref('')
const filteredConfigs = computed(() => {
  if (!selectedPo.value) return []
  const list = [...selectedPo.value.regionalConfigs]
  // Sort: base region first, then alphabetical by display name.
  list.sort((a, b) => {
    if (baseRegion.value) {
      if (a.regionCode === baseRegion.value) return -1
      if (b.regionCode === baseRegion.value) return 1
    }
    return regionLabel(a.regionCode).localeCompare(regionLabel(b.regionCode), 'en')
  })
  const q = regionSearch.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (c) =>
      c.regionCode.toLowerCase().includes(q) ||
      regionLabel(c.regionCode).toLowerCase().includes(q)
  )
})

function formatPrice(p?: RegionalConfig['price']): string {
  if (!p) return '-'
  const whole = p.units
  const frac = Math.round(p.nanos / 1e7).toString().padStart(2, '0')
  return `${p.currencyCode} ${whole}.${frac}`
}

// ── Listings CRUD (local edit buffer, save replaces the full array) ──
const editingListing = ref<Listing | null>(null)
const editingIsNew = ref(false)
const listingSaving = ref(false)

const languageOptions = GOOGLE_LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
  right: l.code
}))

const usedLanguageCodes = computed(() => new Set((detail.value?.listings || []).map((l) => l.languageCode)))

const addableLanguageOptions = computed(() => {
  if (!editingListing.value) return languageOptions
  // When editing existing, keep the current code selectable; when adding new, hide already-used.
  if (editingIsNew.value) {
    return languageOptions.filter((o) => !usedLanguageCodes.value.has(o.value))
  }
  return languageOptions
})

function openNewListing() {
  editingListing.value = { languageCode: '', title: '', description: '' }
  editingIsNew.value = true
}

function openEditListing(l: Listing) {
  editingListing.value = { ...l }
  editingIsNew.value = false
}

function cancelEditListing() {
  editingListing.value = null
}

async function saveListing() {
  if (!editingListing.value || !detail.value) return
  const e = editingListing.value
  if (!e.languageCode) {
    notify.error('請選擇語言')
    return
  }
  if (!e.title.trim()) {
    notify.error('請填寫名稱')
    return
  }
  // Build a plain array (not reactive proxies) so Electron IPC can clone it.
  const next: Listing[] = detail.value.listings.map((l) => ({
    languageCode: l.languageCode,
    title: l.title,
    description: l.description
  }))
  if (editingIsNew.value) {
    if (next.some((l) => l.languageCode === e.languageCode)) {
      notify.error('此語言已存在')
      return
    }
    next.push({ languageCode: e.languageCode, title: e.title.trim(), description: e.description.trim() })
  } else {
    const idx = next.findIndex((l) => l.languageCode === e.languageCode)
    if (idx < 0) {
      notify.error('找不到要更新的 listing')
      return
    }
    next[idx] = { languageCode: e.languageCode, title: e.title.trim(), description: e.description.trim() }
  }
  listingSaving.value = true
  const result = await window.api.updateGoogleListings(props.projectId, props.product.productId, next)
  listingSaving.value = false
  if (result.success && result.data) {
    detail.value = result.data
    editingListing.value = null
    notify.success('Listings 已更新')
    emit('updated')
  } else {
    notify.error(result.error || '儲存失敗')
  }
}

// ── Price editing ──
const editRegion = ref('')
const editPrice = ref('')
const pricingSaving = ref(false)

function parsePriceToUnitsNanos(input: string): { units: string; nanos: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [intPart, fracPart = ''] = trimmed.split('.')
  const paddedFrac = (fracPart + '000000000').slice(0, 9)
  return { units: intPart, nanos: Number(paddedFrac) }
}

function formatPriceForInput(p?: RegionalConfig['price']): string {
  if (!p) return ''
  if (p.nanos === 0) return p.units
  const frac = String(p.nanos).padStart(9, '0').replace(/0+$/, '')
  return `${p.units}.${frac}`
}

// When entering pricing tab or PO changes, prefill form from current data.
function syncPricingForm() {
  if (!selectedPo.value) {
    editRegion.value = ''
    editPrice.value = ''
    return
  }
  const defaultRegion = baseRegion.value
    || selectedPo.value.regionalConfigs[0]?.regionCode
    || ''
  editRegion.value = defaultRegion
  const cfg = selectedPo.value.regionalConfigs.find((c) => c.regionCode === defaultRegion)
  editPrice.value = formatPriceForInput(cfg?.price)
}

// When edit region changes, sync price to that region's current price.
watch(editRegion, (newCode) => {
  if (!selectedPo.value || !newCode) return
  const cfg = selectedPo.value.regionalConfigs.find((c) => c.regionCode === newCode)
  editPrice.value = formatPriceForInput(cfg?.price)
})

async function applyNewPricing() {
  if (!detail.value || !selectedPo.value) return
  if (!editRegion.value) {
    notify.error('請選擇基準國家')
    return
  }
  const currency = currencyForRegion(editRegion.value)
  if (!currency) {
    notify.error('找不到該國家的幣別')
    return
  }
  const parsed = parsePriceToUnitsNanos(editPrice.value)
  if (!parsed) {
    notify.error('請輸入有效的價格')
    return
  }
  if (!confirm(`確定要用 ${editRegion.value} ${currency} ${editPrice.value} 當基準，更新所有地區的價格嗎？`)) return

  pricingSaving.value = true
  const result = await window.api.updateGooglePurchaseOptionPricing(
    props.projectId,
    props.product.productId,
    selectedPo.value.purchaseOptionId,
    { currencyCode: currency, units: parsed.units, nanos: parsed.nanos },
    editRegion.value
  )
  pricingSaving.value = false
  if (result.success) {
    const skipped = (result as any).skippedRegions as string[] | undefined
    if (skipped && skipped.length > 0) {
      notify.success(`定價已更新，略過 ${skipped.length} 個地區：${skipped.join(', ')}`)
    } else {
      notify.success('定價已更新')
    }
    await loadDetail()
    emit('updated')
  } else {
    notify.error(result.error || '更新失敗')
  }
}

function availableRegionCount(po: PurchaseOption): number {
  return po.regionalConfigs.filter((c) => c.availability === 'AVAILABLE').length
}

// ── Add purchase option ──
const showAddPoForm = ref(false)
const addPoSaving = ref(false)
const newPo = ref({
  purchaseOptionId: '',
  baseRegionCode: '',
  basePrice: ''
})

function openAddPoForm() {
  newPo.value = {
    purchaseOptionId: '',
    baseRegionCode: baseRegion.value || '',
    basePrice: ''
  }
  showAddPoForm.value = true
}

function cancelAddPoForm() {
  showAddPoForm.value = false
}

async function saveNewPurchaseOption() {
  if (!detail.value) return
  const id = newPo.value.purchaseOptionId.trim()
  if (!id) {
    notify.error('請輸入 Purchase Option ID')
    return
  }
  if (detail.value.purchaseOptions.some((po) => po.purchaseOptionId === id)) {
    notify.error('此 Purchase Option ID 已存在')
    return
  }
  if (!newPo.value.baseRegionCode) {
    notify.error('請選擇基準國家')
    return
  }
  const currency = currencyForRegion(newPo.value.baseRegionCode)
  if (!currency) {
    notify.error('找不到該國家的幣別')
    return
  }
  const parsed = parsePriceToUnitsNanos(newPo.value.basePrice)
  if (!parsed) {
    notify.error('請輸入有效的價格')
    return
  }

  addPoSaving.value = true
  const result = await window.api.addGooglePurchaseOption(
    props.projectId,
    props.product.productId,
    id,
    { currencyCode: currency, units: parsed.units, nanos: parsed.nanos },
    newPo.value.baseRegionCode
  )
  addPoSaving.value = false
  if (result.success) {
    const skipped = (result as any).skippedRegions as string[] | undefined
    if (skipped && skipped.length > 0) {
      notify.success(`方案已新增，略過 ${skipped.length} 個地區：${skipped.join(', ')}`)
    } else {
      notify.success('方案已新增')
    }
    showAddPoForm.value = false
    await loadDetail()
    emit('updated')
  } else {
    notify.error(result.error || '新增失敗')
  }
}

// ── Purchase option state toggle ──
const togglingPoId = ref('')

async function togglePurchaseOptionState(po: PurchaseOption) {
  if (!detail.value) return
  const willActivate = po.state !== 'ACTIVE'
  const label = willActivate ? '上架' : '下架'
  if (!confirm(`確定要${label}方案「${po.purchaseOptionId}」嗎？`)) return

  togglingPoId.value = po.purchaseOptionId
  const result = await window.api.setGooglePurchaseOptionState(
    props.projectId,
    props.product.productId,
    po.purchaseOptionId,
    willActivate
  )
  togglingPoId.value = ''
  if (result.success) {
    notify.success(`方案已${label}`)
    await loadDetail()
    emit('updated')
  } else {
    notify.error(result.error || `${label}失敗`)
  }
}

async function deleteListing(languageCode: string) {
  if (!detail.value) return
  if (detail.value.listings.length <= 1) {
    notify.error('至少需保留一個 listing')
    return
  }
  if (!confirm(`確定刪除 ${getLanguageLabel(languageCode)} 的 listing 嗎？`)) return
  const next: Listing[] = detail.value.listings
    .filter((l) => l.languageCode !== languageCode)
    .map((l) => ({
      languageCode: l.languageCode,
      title: l.title,
      description: l.description
    }))
  const result = await window.api.updateGoogleListings(props.projectId, props.product.productId, next)
  if (result.success && result.data) {
    detail.value = result.data
    notify.success('已刪除')
    emit('updated')
  } else {
    notify.error(result.error || '刪除失敗')
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: '上架中',
    INACTIVE: '已下架',
    INACTIVE_PUBLISHED: '已下架（保留）',
    DRAFT: '草稿',
    NO_PURCHASE_OPTION: '未設定方案',
    UNKNOWN: '未知'
  }
  return map[status] || status
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

// Refetch when switching tabs is not needed (we load everything upfront).
watch(activeTab, (tab) => {
  regionSearch.value = ''
  if (tab === 'pricing') syncPricingForm()
})
watch(selectedPoId, () => {
  if (activeTab.value === 'pricing') syncPricingForm()
})
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-40" @click.self="emit('close')">
    <div class="bg-[#2b2d30] rounded-xl shadow-xl w-full max-w-3xl h-[85vh] border border-[#393b40] flex flex-col overflow-hidden titlebar-no-drag">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#393b40] shrink-0">
        <div>
          <h3 class="text-lg font-semibold text-gray-100">{{ product.name || product.productId }}</h3>
          <p class="text-sm text-gray-400 font-mono">{{ product.productId }}</p>
        </div>
        <button @click="emit('close')" class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors">&times;</button>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-[#393b40] px-6 shrink-0">
        <button
          v-for="tab in (['info', 'purchaseOptions', 'pricing', 'listings'] as Tab[])"
          :key="tab"
          @click="activeTab = tab"
          class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px"
          :class="activeTab === tab
            ? 'border-green-500 text-green-400'
            : 'border-transparent text-gray-400 hover:text-gray-200'"
        >
          {{ tab === 'info' ? 'Info' : tab === 'purchaseOptions' ? 'Purchase Options' : tab === 'pricing' ? 'Pricing' : 'Listings' }}
        </button>
      </div>

      <!-- Tab content -->
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-500">載入中...</div>

        <template v-else-if="detail">
          <!-- ── Info Tab ── -->
          <div v-if="activeTab === 'info'" class="flex-1 overflow-y-auto p-6 space-y-5">
            <div>
              <label class="block text-xs font-medium text-gray-500 uppercase mb-1">Product ID</label>
              <div class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-400 font-mono">
                {{ detail.productId }}
              </div>
              <p class="text-xs text-gray-500 mt-1">Product ID 建立後無法修改</p>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 uppercase mb-1">Status</label>
              <div>
                <span class="inline-block text-xs px-2 py-0.5 rounded-full" :class="statusColor(derivedStatus)">
                  {{ derivedStatusLabel }}
                </span>
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 uppercase mb-1">Purchase Options</label>
              <div class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-400">
                共 {{ detail.purchaseOptions.length }} 個方案
              </div>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-500 uppercase mb-1">Listings</label>
              <div class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-400">
                共 {{ detail.listings.length }} 個語言
              </div>
            </div>
          </div>

          <!-- ── Purchase Options Tab ── -->
          <div v-if="activeTab === 'purchaseOptions'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div class="shrink-0 px-6 pt-4 pb-3 flex items-center justify-between">
              <span class="text-sm text-gray-400">共 {{ detail.purchaseOptions.length }} 個方案</span>
              <button
                @click="openAddPoForm"
                class="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
              >
                + 新增方案
              </button>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
              <div v-if="detail.purchaseOptions.length === 0" class="text-center py-10 text-gray-500">尚無方案</div>
              <div v-else class="space-y-2">
                <div
                  v-for="po in detail.purchaseOptions"
                  :key="po.purchaseOptionId"
                  class="flex items-center justify-between gap-3 px-3 py-3 bg-[#1e1f22] border border-[#43454a] rounded-lg"
                >
                  <div class="min-w-0 flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-mono text-gray-200">{{ po.purchaseOptionId }}</span>
                    <span class="text-xs text-gray-500">{{ po.type }}</span>
                    <span class="text-xs text-gray-500">· {{ availableRegionCount(po) }} countries / regions</span>
                    <span
                      v-if="po.legacyCompatible"
                      class="text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400"
                    >
                      Backwards compatible
                    </span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-xs px-2 py-0.5 rounded-full" :class="statusColor(po.state)">
                      {{ statusLabel(po.state) }}
                    </span>
                    <button
                      v-if="po.state === 'ACTIVE'"
                      @click="togglePurchaseOptionState(po)"
                      :disabled="togglingPoId === po.purchaseOptionId"
                      class="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
                    >
                      {{ togglingPoId === po.purchaseOptionId ? '...' : '下架' }}
                    </button>
                    <button
                      v-else
                      @click="togglePurchaseOptionState(po)"
                      :disabled="togglingPoId === po.purchaseOptionId"
                      class="text-xs px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors disabled:opacity-50"
                    >
                      {{ togglingPoId === po.purchaseOptionId ? '...' : '上架' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Pricing shared controls ── -->
          <div v-if="activeTab === 'pricing'" class="shrink-0 px-6 pt-4">
            <div class="flex items-center gap-3">
              <div class="flex-1">
                <label class="block text-xs font-medium text-gray-500 uppercase mb-1">方案</label>
                <SearchableSelect
                  v-if="poOptions.length > 1"
                  v-model="selectedPoId"
                  :options="poOptions"
                  placeholder="選擇方案"
                />
                <div
                  v-else-if="selectedPo"
                  class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200"
                >
                  {{ selectedPo.purchaseOptionId }}
                  <span class="text-xs text-gray-500 ml-2">{{ selectedPo.type }} · {{ statusLabel(selectedPo.state) }}</span>
                </div>
              </div>
              <div class="flex-1">
                <label class="block text-xs font-medium text-gray-500 uppercase mb-1">搜尋地區</label>
                <input
                  v-model="regionSearch"
                  type="text"
                  placeholder="代碼或名稱"
                  class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
                />
              </div>
            </div>
          </div>

          <!-- ── Pricing Tab ── -->
          <div v-if="activeTab === 'pricing'" class="flex-1 min-h-0 flex flex-col px-6 pb-6 pt-4">
            <div v-if="!selectedPo" class="text-center py-10 text-gray-500">沒有方案</div>
            <template v-else>
              <!-- Edit form -->
              <div class="mb-3 p-3 bg-[#1e1f22] border border-[#43454a] rounded-lg">
                <div class="text-xs font-medium text-gray-500 uppercase mb-2">調整基準定價</div>
                <div class="flex items-end gap-2">
                  <div class="flex-1 min-w-0">
                    <label class="block text-xs text-gray-500 mb-1">基準國家</label>
                    <SearchableSelect
                      v-model="editRegion"
                      :options="regionOptionsForEdit"
                      placeholder="選擇基準國家"
                    />
                  </div>
                  <div class="w-28 shrink-0">
                    <label class="block text-xs text-gray-500 mb-1">價格</label>
                    <input
                      v-model="editPrice"
                      type="text"
                      inputmode="decimal"
                      class="w-full px-3 py-1.5 bg-[#2b2d30] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="0"
                    />
                  </div>
                  <span class="text-sm text-gray-400 py-1.5 px-2 min-w-[3.5rem] text-center">
                    {{ currencyForRegion(editRegion) || '---' }}
                  </span>
                  <button
                    @click="applyNewPricing"
                    :disabled="pricingSaving"
                    class="px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {{ pricingSaving ? '套用中...' : '套用新價格' }}
                  </button>
                </div>
                <p class="text-xs text-gray-500 mt-2">套用後其他國家的價格由 Google 自動換算，將覆蓋目前所有地區的定價。</p>
              </div>
            <div class="flex-1 min-h-0 bg-[#1e1f22] border border-[#43454a] rounded-lg flex flex-col overflow-hidden">
              <div class="shrink-0 pr-[6px]">
                <table class="w-full text-sm table-fixed">
                  <colgroup>
                    <col class="w-[50%]" />
                    <col class="w-[20%]" />
                    <col class="w-[30%]" />
                  </colgroup>
                  <thead>
                    <tr class="text-left text-xs text-gray-500 uppercase bg-[#22252a] border-b border-[#393b40]">
                      <th class="px-3 py-2 font-medium">地區</th>
                      <th class="px-3 py-2 font-medium">代碼</th>
                      <th class="px-3 py-2 font-medium">價格</th>
                    </tr>
                  </thead>
                </table>
              </div>
              <div class="flex-1 min-h-0 overflow-y-auto">
                <table class="w-full text-sm table-fixed">
                  <colgroup>
                    <col class="w-[50%]" />
                    <col class="w-[20%]" />
                    <col class="w-[30%]" />
                  </colgroup>
                  <tbody>
                    <tr
                      v-for="c in filteredConfigs"
                      :key="c.regionCode"
                      class="border-b border-[#393b40]/50 hover:bg-[#2e3038] transition-colors"
                      :class="{ 'bg-green-600/10': c.regionCode === baseRegion }"
                    >
                      <td class="px-3 py-2 text-gray-200">
                        {{ regionLabel(c.regionCode) }}
                      </td>
                      <td class="px-3 py-2 text-gray-500 font-mono">{{ c.regionCode }}</td>
                      <td class="px-3 py-2 text-gray-300 font-mono">{{ formatPrice(c.price) }}</td>
                    </tr>
                    <tr v-if="filteredConfigs.length === 0">
                      <td colspan="3" class="px-3 py-6 text-center text-gray-500">找不到地區</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            </template>
          </div>

          <!-- ── Listings Tab ── -->
          <div v-if="activeTab === 'listings'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div class="shrink-0 px-6 pt-4 pb-3 flex items-center justify-between">
              <span class="text-sm text-gray-400">共 {{ detail.listings.length }} 個語言</span>
              <button
                @click="openNewListing"
                class="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
              >
                + 新增語言
              </button>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
              <div v-if="detail.listings.length === 0" class="text-center py-10 text-gray-500">尚無 listings</div>
              <div v-else class="space-y-2">
                <div
                  v-for="l in detail.listings"
                  :key="l.languageCode"
                  class="p-3 bg-[#1e1f22] border border-[#43454a] rounded-lg"
                >
                  <div class="flex items-center justify-between mb-2">
                    <div>
                      <span class="text-sm font-medium text-gray-200">{{ getLanguageLabel(l.languageCode) }}</span>
                      <span class="text-xs text-gray-500 ml-2 font-mono">{{ l.languageCode }}</span>
                    </div>
                    <div class="flex gap-2">
                      <button
                        @click="openEditListing(l)"
                        class="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-[#393b40] transition-colors"
                      >編輯</button>
                      <button
                        @click="deleteListing(l.languageCode)"
                        class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-[#393b40] transition-colors"
                      >刪除</button>
                    </div>
                  </div>
                  <div class="text-sm text-gray-200 mb-1">{{ l.title }}</div>
                  <div class="text-xs text-gray-500 whitespace-pre-wrap">{{ l.description || '（無描述）' }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Add Purchase Option Dialog -->
    <div
      v-if="showAddPoForm"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      @click.self="cancelAddPoForm"
    >
      <div class="bg-[#2b2d30] rounded-xl shadow-xl w-full max-w-md border border-[#393b40] titlebar-no-drag flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h3 class="text-lg font-semibold text-gray-100">新增 Purchase Option</h3>
          <button @click="cancelAddPoForm" class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors">&times;</button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-2 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">Purchase Option ID</label>
            <input
              v-model="newPo.purchaseOptionId"
              type="text"
              placeholder="例如：premium"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500 font-mono"
            />
            <p class="text-xs text-gray-500 mt-1">建立後無法修改</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">基準國家</label>
            <SearchableSelect
              v-model="newPo.baseRegionCode"
              :options="regionOptionsForEdit"
              placeholder="選擇基準國家"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">基準價格</label>
            <div class="flex items-center gap-2">
              <input
                v-model="newPo.basePrice"
                type="text"
                inputmode="decimal"
                placeholder="0"
                class="flex-1 px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
              />
              <span class="text-sm text-gray-400 min-w-[3.5rem] text-center">
                {{ currencyForRegion(newPo.baseRegionCode) || '---' }}
              </span>
            </div>
            <p class="text-xs text-gray-500 mt-1">其他國家的價格由 Google 自動換算。新方案建立後為 DRAFT 狀態，需要手動上架。</p>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 shrink-0 border-t border-[#393b40]">
          <button @click="cancelAddPoForm" class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors">
            取消
          </button>
          <button
            @click="saveNewPurchaseOption"
            :disabled="addPoSaving"
            class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {{ addPoSaving ? '新增中...' : '新增' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Listing Edit Dialog -->
    <div
      v-if="editingListing"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      @click.self="cancelEditListing"
    >
      <div class="bg-[#2b2d30] rounded-xl shadow-xl w-full max-w-md border border-[#393b40] titlebar-no-drag flex flex-col max-h-[85vh]">
        <div class="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h3 class="text-lg font-semibold text-gray-100">{{ editingIsNew ? '新增 Listing' : '編輯 Listing' }}</h3>
          <button @click="cancelEditListing" class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors">&times;</button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-2 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">語言</label>
            <SearchableSelect
              v-if="editingIsNew"
              v-model="editingListing.languageCode"
              :options="addableLanguageOptions"
              placeholder="選擇語言"
            />
            <div v-else class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-400">
              {{ getLanguageLabel(editingListing.languageCode) }}
              <span class="text-xs text-gray-500 ml-2 font-mono">{{ editingListing.languageCode }}</span>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">名稱 (title)</label>
            <input
              v-model="editingListing.title"
              type="text"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">描述 (description)</label>
            <textarea
              v-model="editingListing.description"
              rows="4"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
            />
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 shrink-0 border-t border-[#393b40]">
          <button @click="cancelEditListing" class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors">
            取消
          </button>
          <button
            @click="saveListing"
            :disabled="listingSaving"
            class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {{ listingSaving ? '儲存中...' : '儲存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
