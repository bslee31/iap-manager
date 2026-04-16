<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import { territoryLabel, groupTerritoriesByRegion, type GroupedTerritory } from '../../utils/territory-names'

const props = defineProps<{
  projectId: string
  product: {
    id: string
    productId: string
    referenceName: string
    type: string
    state: string
    territoryCount: number
  }
}>()

const emit = defineEmits<{ close: []; updated: [] }>()
const notify = useNotificationStore()

// Tabs
type Tab = 'availability' | 'price' | 'localization'
const activeTab = ref<Tab>('availability')

// ── Availability ──
const availLoading = ref(false)
const availSaving = ref(false)
const availableInNewTerritories = ref(false)
const selectedTerritories = ref<Set<string>>(new Set())
const allTerritories = ref<{ id: string; currency: string }[]>([])
const territorySearch = ref('')
const collapsedRegions = ref<Set<string>>(new Set())

const groupedTerritories = computed<GroupedTerritory[]>(() => {
  const codes = allTerritories.value.map((t) => t.id)
  const groups = groupTerritoriesByRegion(codes)
  if (!territorySearch.value.trim()) return groups
  const q = territorySearch.value.trim().toLowerCase()
  return groups
    .map((g) => ({
      ...g,
      territories: g.territories.filter(
        (t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)
      )
    }))
    .filter((g) => g.territories.length > 0)
})

function toggleRegion(regionName: string) {
  const s = new Set(collapsedRegions.value)
  if (s.has(regionName)) s.delete(regionName)
  else s.add(regionName)
  collapsedRegions.value = s
}

function regionSelectedCount(group: GroupedTerritory): number {
  return group.territories.filter((t) => selectedTerritories.value.has(t.code)).length
}

function toggleRegionAll(group: GroupedTerritory) {
  const s = new Set(selectedTerritories.value)
  const allSelected = group.territories.every((t) => s.has(t.code))
  for (const t of group.territories) {
    if (allSelected) s.delete(t.code)
    else s.add(t.code)
  }
  selectedTerritories.value = s
}

async function loadAvailability() {
  availLoading.value = true
  try {
    const [availResult, terrResult] = await Promise.all([
      window.api.getAppleAvailabilityDetail(props.projectId, props.product.id),
      window.api.getAllTerritories(props.projectId)
    ])
    if (availResult.success) {
      availableInNewTerritories.value = availResult.data.availableInNewTerritories
      selectedTerritories.value = new Set(availResult.data.territoryIds)
    }
    if (terrResult.success) {
      allTerritories.value = terrResult.data
    }
  } catch (e: any) {
    notify.error('載入 Availability 失敗')
  }
  availLoading.value = false
}

function toggleTerritory(id: string) {
  const s = new Set(selectedTerritories.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedTerritories.value = s
}

function selectAllTerritories() {
  selectedTerritories.value = new Set(allTerritories.value.map((t) => t.id))
}

function deselectAllTerritories() {
  selectedTerritories.value = new Set()
}

async function saveAvailability() {
  availSaving.value = true
  const result = await window.api.updateAppleAvailability(
    props.projectId,
    props.product.id,
    Array.from(selectedTerritories.value),
    availableInNewTerritories.value
  )
  availSaving.value = false
  if (result.success) {
    notify.success('Availability 已更新')
    emit('updated')
  } else {
    notify.error(result.error || '更新失敗')
  }
}

// ── Localizations ──
interface Localization {
  id: string
  locale: string
  name: string
  description: string
}

const locLoading = ref(false)
const localizations = ref<Localization[]>([])
const editingLoc = ref<{ id?: string; locale: string; name: string; description: string } | null>(null)
const locSaving = ref(false)
const primaryLocale = ref('en-US')

async function loadLocalizations() {
  locLoading.value = true
  const [locResult, localeResult] = await Promise.all([
    window.api.getAppleLocalizations(props.projectId, props.product.id),
    primaryLocale.value === 'en-US' ? window.api.getApplePrimaryLocale(props.projectId) : null
  ])
  if (locResult.success) {
    localizations.value = locResult.data
  }
  if (localeResult?.success) {
    primaryLocale.value = localeResult.data
  }
  locLoading.value = false
}

const availableLocales = computed(() => {
  const existing = new Set(localizations.value.map((l) => l.locale))
  return LOCALES.filter((l) => !existing.has(l.value))
})

function openLocForm(loc?: Localization) {
  if (loc) {
    editingLoc.value = { id: loc.id, locale: loc.locale, name: loc.name, description: loc.description }
  } else {
    const existing = new Set(localizations.value.map((l) => l.locale))
    const defaultLocale = existing.has(primaryLocale.value) ? '' : primaryLocale.value
    editingLoc.value = { locale: defaultLocale, name: '', description: '' }
  }
}

async function saveLoc() {
  if (!editingLoc.value) return
  locSaving.value = true

  if (editingLoc.value.id) {
    const result = await window.api.updateAppleLocalization(
      props.projectId,
      editingLoc.value.id,
      { name: editingLoc.value.name, description: editingLoc.value.description }
    )
    if (result.success) {
      notify.success('已更新')
      await loadLocalizations()
    } else {
      notify.error(result.error || '更新失敗')
    }
  } else {
    if (!editingLoc.value.locale || !editingLoc.value.name) {
      notify.error('請填寫 Locale 和 Name')
      locSaving.value = false
      return
    }
    const result = await window.api.createAppleLocalization(
      props.projectId,
      props.product.id,
      { locale: editingLoc.value.locale, name: editingLoc.value.name, description: editingLoc.value.description }
    )
    if (result.success) {
      notify.success('已新增')
      await loadLocalizations()
    } else {
      notify.error(result.error || '新增失敗')
    }
  }

  editingLoc.value = null
  locSaving.value = false
}

async function deleteLoc(loc: Localization) {
  if (!confirm(`確定要刪除 ${loc.locale} 的本地化資料嗎？`)) return
  const result = await window.api.deleteAppleLocalization(props.projectId, loc.id)
  if (result.success) {
    notify.success('已刪除')
    await loadLocalizations()
  } else {
    notify.error(result.error || '刪除失敗')
  }
}

// ── Price Schedule ──
interface PriceInfo {
  startDate: string | null
  endDate: string | null
  territory: string
  price: string
  pricePointId: string
}

interface PricePoint {
  id: string
  customerPrice: string
  proceeds: string
  territory: string
}

const priceLoading = ref(false)
const priceSaving = ref(false)
const prices = ref<PriceInfo[]>([])
const pricePoints = ref<PricePoint[]>([])
const selectedTerritory = ref('USA')
const selectedPricePoint = ref('')
const pricePointsLoading = ref(false)

async function loadPriceSchedule() {
  priceLoading.value = true
  const result = await window.api.getApplePriceSchedule(props.projectId, props.product.id)
  if (result.success) {
    prices.value = result.data
  }
  priceLoading.value = false
}

async function loadPricePoints() {
  pricePointsLoading.value = true
  const result = await window.api.getApplePricePoints(
    props.projectId,
    props.product.id,
    selectedTerritory.value
  )
  if (result.success) {
    pricePoints.value = result.data
  }
  pricePointsLoading.value = false
}

async function savePriceSchedule() {
  if (!selectedPricePoint.value) {
    notify.error('請選擇價格')
    return
  }
  priceSaving.value = true
  const result = await window.api.setApplePriceSchedule(
    props.projectId,
    props.product.id,
    selectedTerritory.value,
    selectedPricePoint.value
  )
  priceSaving.value = false
  if (result.success) {
    notify.success('價格已更新')
    await loadPriceSchedule()
  } else {
    notify.error(result.error || '更新失敗')
  }
}

// Load data when tab changes
watch(activeTab, (tab) => {
  if (tab === 'availability' && allTerritories.value.length === 0) loadAvailability()
  if (tab === 'localization' && localizations.value.length === 0) loadLocalizations()
  if (tab === 'price' && prices.value.length === 0) loadPriceSchedule()
})

onMounted(() => {
  loadAvailability()
})

function localeLabel(code: string): string {
  return LOCALES.find((l) => l.value === code)?.label || code
}

const LOCALES = [
  { value: 'ar-SA', label: 'Arabic' },
  { value: 'bn-BD', label: 'Bangla' },
  { value: 'ca', label: 'Catalan' },
  { value: 'zh-Hans', label: 'Chinese (Simplified)' },
  { value: 'zh-Hant', label: 'Chinese (Traditional)' },
  { value: 'hr', label: 'Croatian' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-GB', label: 'English (U.K.)' },
  { value: 'en-US', label: 'English (U.S.)' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'fr-CA', label: 'French (Canada)' },
  { value: 'de-DE', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'gu-IN', label: 'Gujarati' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'kn-IN', label: 'Kannada' },
  { value: 'ko', label: 'Korean' },
  { value: 'ms', label: 'Malay' },
  { value: 'ml-IN', label: 'Malayalam' },
  { value: 'mr-IN', label: 'Marathi' },
  { value: 'no', label: 'Norwegian' },
  { value: 'or-IN', label: 'Odia' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'pt-PT', label: 'Portuguese (Portugal)' },
  { value: 'pa-IN', label: 'Punjabi' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl-SI', label: 'Slovenian' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'sv', label: 'Swedish' },
  { value: 'ta-IN', label: 'Tamil' },
  { value: 'te-IN', label: 'Telugu' },
  { value: 'th', label: 'Thai' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ur-PK', label: 'Urdu' },
  { value: 'vi', label: 'Vietnamese' }
]
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-40" @click.self="emit('close')">
    <div class="bg-[#2b2d30] rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] border border-[#393b40] flex flex-col overflow-hidden titlebar-no-drag">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#393b40] shrink-0">
        <div>
          <h3 class="text-lg font-semibold text-gray-100">{{ product.referenceName }}</h3>
          <p class="text-sm text-gray-400 font-mono">{{ product.productId }}</p>
        </div>
        <button @click="emit('close')" class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors">&times;</button>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-[#393b40] px-6 shrink-0">
        <button
          v-for="tab in (['availability', 'price', 'localization'] as Tab[])"
          :key="tab"
          @click="activeTab = tab"
          class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px"
          :class="activeTab === tab
            ? 'border-blue-500 text-blue-400'
            : 'border-transparent text-gray-400 hover:text-gray-200'"
        >
          {{ tab === 'availability' ? 'Availability' : tab === 'price' ? 'Price Schedule' : 'Localization' }}
        </button>
      </div>

      <!-- Tab content -->
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">

        <!-- ── Availability Tab ── -->
        <div v-if="activeTab === 'availability'" class="flex flex-col flex-1 min-h-0">
          <div v-if="availLoading" class="text-center py-10 text-gray-500">載入中...</div>
          <template v-else>
            <!-- Top controls (fixed) -->
            <div class="px-6 pt-6 pb-2 shrink-0">
              <div class="flex items-center justify-between mb-4">
                <h4 class="text-sm font-medium text-gray-200">
                  Country or Region Availability ({{ selectedTerritories.size }})
                </h4>
                <input
                  v-model="territorySearch"
                  type="text"
                  class="px-2 py-1 bg-[#1e1f22] border border-[#43454a] rounded text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500 w-40"
                  placeholder="搜尋地區..."
                />
              </div>
              <div class="flex items-center gap-1 text-xs">
                <span class="text-gray-500">Select</span>
                <button @click="selectAllTerritories" class="text-blue-400 hover:text-blue-300 underline">All</button>
                <span class="text-gray-600">|</span>
                <button @click="deselectAllTerritories" class="text-blue-400 hover:text-blue-300 underline">None</button>
              </div>
            </div>

            <!-- Scrollable region list -->
            <div class="flex-1 min-h-0 overflow-y-auto px-6 py-2 space-y-1">
              <div v-for="group in groupedTerritories" :key="group.regionName">
                <button
                  @click="toggleRegion(group.regionName)"
                  class="w-full flex items-center gap-2 px-3 py-2 bg-[#1e1f22] rounded-lg text-sm font-medium text-gray-200 hover:bg-[#333538] transition-colors"
                >
                  <span
                    class="text-[10px] text-gray-500 transition-transform"
                    :class="{ '-rotate-90': collapsedRegions.has(group.regionName) }"
                  >&#9660;</span>
                  <span class="flex-1 text-left">{{ group.regionName }} ({{ regionSelectedCount(group) }})</span>
                  <span
                    @click.stop="toggleRegionAll(group)"
                    class="text-xs text-blue-400 hover:text-blue-300 px-1"
                  >
                    {{ group.territories.every(t => selectedTerritories.has(t.code)) ? 'Deselect All' : 'Select All' }}
                  </span>
                </button>
                <div v-if="!collapsedRegions.has(group.regionName)" class="ml-3">
                  <label
                    v-for="t in group.territories"
                    :key="t.code"
                    class="flex items-center gap-2 px-3 py-1.5 rounded text-sm cursor-pointer transition-colors hover:bg-[#2e3038]"
                    :class="selectedTerritories.has(t.code) ? 'text-gray-200' : 'text-gray-400'"
                  >
                    <input
                      type="checkbox"
                      :checked="selectedTerritories.has(t.code)"
                      @change="toggleTerritory(t.code)"
                      class="rounded w-3.5 h-3.5"
                    />
                    {{ t.name }}
                  </label>
                </div>
              </div>
            </div>

            <!-- Footer (pinned at bottom) -->
            <div class="px-6 py-4 border-t border-[#393b40] shrink-0">
              <label class="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" v-model="availableInNewTerritories" class="rounded" />
                <span class="text-sm text-gray-300">Make your in-app purchase automatically available in all future App Store countries or regions.</span>
              </label>
              <div class="flex justify-end">
                <button
                  @click="saveAvailability"
                  :disabled="availSaving"
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {{ availSaving ? '儲存中...' : '儲存 Availability' }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Price Schedule Tab ── -->
        <div v-if="activeTab === 'price'" class="flex-1 overflow-y-auto p-6">
          <div v-if="priceLoading" class="text-center py-10 text-gray-500">載入中...</div>
          <template v-else>
            <!-- Current prices -->
            <h4 class="text-sm font-medium text-gray-300 mb-3">目前價格</h4>
            <div v-if="prices.length > 0" class="bg-[#1e1f22] rounded-lg border border-[#393b40] overflow-hidden mb-6">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-[#393b40]">
                    <th class="text-left px-3 py-2 text-xs font-medium text-gray-500">地區</th>
                    <th class="text-left px-3 py-2 text-xs font-medium text-gray-500">價格</th>
                    <th class="text-left px-3 py-2 text-xs font-medium text-gray-500">開始日期</th>
                    <th class="text-left px-3 py-2 text-xs font-medium text-gray-500">結束日期</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(p, i) in prices" :key="i" class="border-b border-[#393b40] last:border-0">
                    <td class="px-3 py-2 text-sm text-gray-300">{{ territoryLabel(p.territory) }}</td>
                    <td class="px-3 py-2 text-sm text-gray-200 font-mono">{{ p.price }}</td>
                    <td class="px-3 py-2 text-sm text-gray-400">{{ p.startDate || '-' }}</td>
                    <td class="px-3 py-2 text-sm text-gray-400">{{ p.endDate || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="text-sm text-gray-500 mb-6">尚未設定價格</p>

            <!-- Set price -->
            <h4 class="text-sm font-medium text-gray-300 mb-3">設定基本價格</h4>
            <div class="space-y-3">
              <div class="flex items-center gap-3">
                <label class="text-sm text-gray-400 shrink-0">基準地區</label>
                <select
                  v-model="selectedTerritory"
                  class="px-3 py-1.5 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="USA">United States (USA)</option>
                  <option value="TWN">Taiwan (TWN)</option>
                  <option value="JPN">Japan (JPN)</option>
                  <option value="GBR">United Kingdom (GBR)</option>
                  <option value="CAN">Canada (CAN)</option>
                  <option value="AUS">Australia (AUS)</option>
                </select>
                <button
                  @click="loadPricePoints"
                  :disabled="pricePointsLoading"
                  class="px-3 py-1.5 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors disabled:opacity-50"
                >
                  {{ pricePointsLoading ? '載入中...' : '載入價格選項' }}
                </button>
              </div>

              <div v-if="pricePoints.length > 0">
                <label class="text-sm text-gray-400 mb-1 block">選擇價格</label>
                <select
                  v-model="selectedPricePoint"
                  class="w-full px-3 py-1.5 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled>請選擇...</option>
                  <option v-for="pp in pricePoints" :key="pp.id" :value="pp.id">
                    {{ pp.customerPrice }} (收益: {{ pp.proceeds }})
                  </option>
                </select>
              </div>

              <div class="flex justify-end">
                <button
                  @click="savePriceSchedule"
                  :disabled="priceSaving || !selectedPricePoint"
                  class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {{ priceSaving ? '儲存中...' : '儲存價格' }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Localization Tab ── -->
        <div v-if="activeTab === 'localization'" class="flex-1 overflow-y-auto p-6">
          <div v-if="locLoading" class="text-center py-10 text-gray-500">載入中...</div>
          <template v-else>
            <!-- Add button -->
            <div class="flex justify-between items-center mb-4">
              <span class="text-sm text-gray-400">{{ localizations.length }} 個語言</span>
              <button
                @click="openLocForm()"
                class="px-3 py-1.5 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors"
              >
                + 新增語言
              </button>
            </div>

            <!-- Localization list -->
            <div v-if="localizations.length > 0" class="space-y-2">
              <div
                v-for="loc in localizations"
                :key="loc.id"
                class="bg-[#1e1f22] rounded-lg border border-[#393b40] px-4 py-3 flex items-start justify-between gap-3"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-xs px-1.5 py-0.5 rounded bg-[#393b40] text-gray-300">{{ localeLabel(loc.locale) }}</span>
                    <span class="text-sm text-gray-200 font-medium truncate">{{ loc.name }}</span>
                  </div>
                  <p v-if="loc.description" class="text-xs text-gray-400 mt-1 line-clamp-2">{{ loc.description }}</p>
                </div>
                <div class="flex gap-1 shrink-0">
                  <button @click="openLocForm(loc)" class="p-1 text-gray-500 hover:text-blue-400 transition-colors" title="編輯">&#9998;</button>
                  <button @click="deleteLoc(loc)" class="p-1 text-gray-500 hover:text-red-400 transition-colors" title="刪除">&#10005;</button>
                </div>
              </div>
            </div>
            <p v-else class="text-sm text-gray-500 text-center py-6">尚未新增任何本地化資料</p>

            <!-- Edit/Create form modal -->
            <div v-if="editingLoc" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div class="bg-[#2b2d30] rounded-xl shadow-xl p-6 w-full max-w-md border border-[#393b40]">
                <h4 class="text-base font-semibold mb-4 text-gray-100">
                  {{ editingLoc.id ? '編輯本地化' : '新增本地化' }}
                </h4>
                <div class="space-y-3">
                  <div>
                    <label class="block text-sm text-gray-400 mb-1">Locale</label>
                    <select
                      v-if="!editingLoc.id"
                      v-model="editingLoc.locale"
                      class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="" disabled>請選擇語言...</option>
                      <option v-for="l in availableLocales" :key="l.value" :value="l.value">{{ l.label }}</option>
                    </select>
                    <span v-else class="text-sm text-gray-300 font-mono">{{ editingLoc.locale }}</span>
                  </div>
                  <div>
                    <div class="flex justify-between mb-1">
                      <label class="text-sm text-gray-400">Name</label>
                      <span class="text-xs" :class="(editingLoc?.name.length ?? 0) > 35 ? 'text-red-400' : 'text-gray-500'">{{ editingLoc?.name.length ?? 0 }} / 35</span>
                    </div>
                    <input
                      v-model="editingLoc.name"
                      type="text"
                      maxlength="35"
                      class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                      placeholder="商品名稱"
                    />
                  </div>
                  <div>
                    <div class="flex justify-between mb-1">
                      <label class="text-sm text-gray-400">Description</label>
                      <span class="text-xs" :class="(editingLoc?.description.length ?? 0) > 55 ? 'text-red-400' : 'text-gray-500'">{{ editingLoc?.description.length ?? 0 }} / 55</span>
                    </div>
                    <textarea
                      v-model="editingLoc.description"
                      rows="3"
                      maxlength="55"
                      class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                      placeholder="商品描述（選填）"
                    />
                  </div>
                </div>
                <div class="flex justify-end gap-2 mt-5">
                  <button @click="editingLoc = null" class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors">取消</button>
                  <button
                    @click="saveLoc"
                    :disabled="locSaving"
                    class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {{ locSaving ? '儲存中...' : '儲存' }}
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>

      </div>
    </div>
  </div>
</template>
