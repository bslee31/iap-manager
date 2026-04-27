<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { territoryName } from '../../../utils/territory-names'
import SearchableSelect from '../../common/SearchableSelect.vue'
import * as appleApi from '../../../services/api/apple'

const props = defineProps<{
  projectId: string
  iapId: string
  // Shared with the Availability tab — read-only here. Used for territory
  // dropdown options and to support the "only show available" filter.
  allTerritories: { id: string; currency: string }[]
  selectedTerritories: Set<string>
}>()

const emit = defineEmits<{
  'update-price': [price: string, currency: string]
}>()

const notify = useNotificationStore()

interface PricePoint {
  id: string
  customerPrice: string
  proceeds: string
  territory: string
}

interface AllTerritoryPricesData {
  baseTerritory: string
  basePrice: string
  baseCurrency: string
  territoryPrices: {
    territory: string
    currency: string
    customerPrice: string
    proceeds: string
    isManual: boolean
  }[]
}

const territoryOptions = computed(() =>
  props.allTerritories
    .map((t) => ({ code: t.id, label: `${territoryName(t.id)} (${t.currency})` }))
    .sort((a, b) => a.label.localeCompare(b.label))
)

const priceLoading = ref(false)
const priceSaving = ref(false)
const pricePoints = ref<PricePoint[]>([])
const selectedTerritory = ref('USA')
const selectedPricePoint = ref('')
const pricePointsLoading = ref(false)

const pricePointOptions = computed(() =>
  pricePoints.value.map((pp) => ({
    value: pp.id,
    label: `${pp.customerPrice} (收益: ${pp.proceeds})`
  }))
)

const allPricesData = ref<AllTerritoryPricesData | null>(null)
const allPricesLoading = ref(false)
const priceSearch = ref('')
const priceOnlyAvailable = ref(false)

const filteredPrices = computed(() => {
  if (!allPricesData.value) return []
  const base = allPricesData.value.baseTerritory
  const list = allPricesData.value.territoryPrices
  const sorted = [...list].sort((a, b) => {
    if (a.territory === base) return -1
    if (b.territory === base) return 1
    if (a.isManual && !b.isManual) return -1
    if (!a.isManual && b.isManual) return 1
    return territoryName(a.territory).localeCompare(territoryName(b.territory))
  })
  let result = sorted
  if (priceOnlyAvailable.value && props.selectedTerritories.size > 0) {
    result = result.filter((tp) => props.selectedTerritories.has(tp.territory))
  }
  if (priceSearch.value.trim()) {
    const q = priceSearch.value.trim().toLowerCase()
    result = result.filter((tp) =>
      territoryName(tp.territory).toLowerCase().includes(q) ||
      tp.territory.toLowerCase().includes(q) ||
      tp.currency.toLowerCase().includes(q)
    )
  }
  return result
})

async function loadAllTerritoryPrices() {
  allPricesLoading.value = true
  const result = await appleApi.getAllTerritoryPrices(props.projectId, props.iapId)
  if (result.success) {
    allPricesData.value = result.data
  }
  allPricesLoading.value = false
}

const editingTerrPrice = ref<{ territory: string; currency: string } | null>(null)
const editTerrPricePoints = ref<PricePoint[]>([])
const editTerrPriceLoading = ref(false)
const editTerrSelectedPP = ref('')
const editTerrSaving = ref(false)

async function openEditTerritoryPrice(tp: { territory: string; currency: string }) {
  editingTerrPrice.value = tp
  editTerrSelectedPP.value = ''
  editTerrPricePoints.value = []
  editTerrPriceLoading.value = true

  const result = await appleApi.getPricePoints(props.projectId, props.iapId, tp.territory)
  if (result.success) {
    editTerrPricePoints.value = result.data
    const currentPrice = allPricesData.value?.territoryPrices.find((p) => p.territory === tp.territory)
    if (currentPrice) {
      const match = result.data.find((pp: PricePoint) => pp.customerPrice === currentPrice.customerPrice)
      if (match) editTerrSelectedPP.value = match.id
    }
  }
  editTerrPriceLoading.value = false
}

async function saveEditTerritoryPrice() {
  if (!editingTerrPrice.value || !editTerrSelectedPP.value) return
  editTerrSaving.value = true
  const result = await appleApi.setManualTerritoryPrice(
    props.projectId,
    props.iapId,
    editingTerrPrice.value.territory,
    editTerrSelectedPP.value
  )
  editTerrSaving.value = false
  if (result.success) {
    notify.success(`${territoryName(editingTerrPrice.value.territory)} 價格已更新`)
    editingTerrPrice.value = null
    await loadAllTerritoryPrices()
  } else {
    notify.error(result.error || '更新失敗')
  }
}

const editTerrPPOptions = computed(() => {
  const baseCurrency = allPricesData.value?.baseCurrency || ''
  const currentPrice = editingTerrPrice.value
    ? allPricesData.value?.territoryPrices.find((p) => p.territory === editingTerrPrice.value!.territory)?.customerPrice
    : ''

  const basePrice = allPricesData.value?.basePrice || ''

  return editTerrPricePoints.value.map((pp) => {
    const isCurrent = pp.customerPrice === currentPrice
    return {
      value: pp.id,
      label: pp.customerPrice,
      right: isCurrent ? `${basePrice} (${baseCurrency})` : ''
    }
  })
})

async function loadPriceSchedule() {
  priceLoading.value = true
  const result = await appleApi.getPriceSchedule(props.projectId, props.iapId)
  if (result.success && result.data.baseTerritory) {
    const next = result.data.baseTerritory
    // When next === current value, the selectedTerritory watcher won't fire
    // (Vue skips no-op assignments), so trigger the load explicitly.
    if (next === selectedTerritory.value) {
      await loadPricePoints()
    } else {
      selectedTerritory.value = next
    }
  }
  priceLoading.value = false
}

async function loadPricePoints() {
  pricePointsLoading.value = true
  const result = await appleApi.getPricePoints(
    props.projectId,
    props.iapId,
    selectedTerritory.value
  )
  if (result.success) {
    pricePoints.value = result.data
    if (allPricesData.value?.basePrice) {
      const match = result.data.find((pp: PricePoint) => pp.customerPrice === allPricesData.value!.basePrice)
      if (match) selectedPricePoint.value = match.id
    }
  }
  pricePointsLoading.value = false
}

async function savePriceSchedule() {
  if (!selectedPricePoint.value) {
    notify.error('請選擇價格')
    return
  }
  priceSaving.value = true
  const result = await appleApi.setPriceSchedule(
    props.projectId,
    props.iapId,
    selectedTerritory.value,
    selectedPricePoint.value
  )
  priceSaving.value = false
  if (result.success) {
    notify.success('價格已更新')
    await Promise.all([loadPriceSchedule(), loadAllTerritoryPrices()])
    if (allPricesData.value) {
      emit('update-price', allPricesData.value.basePrice, allPricesData.value.baseCurrency)
    }
  } else {
    notify.error(result.error || '更新失敗')
  }
}

watch(selectedTerritory, (code) => {
  if (!code) return
  loadPricePoints()
})

onMounted(() => {
  loadPriceSchedule()
  loadAllTerritoryPrices()
})
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div v-if="priceLoading" class="text-center py-10 text-gray-500">載入中...</div>
    <template v-else>
      <!-- Set base price -->
      <div class="px-6 pt-4 pb-3 shrink-0">
        <div class="p-3 bg-[#1e1f22] border border-[#43454a] rounded-lg">
          <div class="text-xs font-medium text-gray-500 uppercase mb-2">調整基準定價</div>
          <div class="flex items-end gap-2">
            <div class="flex-1 min-w-0">
              <label class="block text-xs text-gray-500 mb-1">基準地區</label>
              <SearchableSelect
                v-model="selectedTerritory"
                :options="territoryOptions.map(t => ({ value: t.code, label: t.label }))"
                placeholder="選擇基準地區..."
              />
            </div>
            <div class="flex-1 min-w-0">
              <label class="block text-xs text-gray-500 mb-1">價格</label>
              <SearchableSelect
                v-model="selectedPricePoint"
                :options="pricePointOptions"
                :placeholder="pricePointsLoading ? '載入價格選項中...' : '選擇價格...'"
              />
            </div>
            <button
              @click="savePriceSchedule"
              :disabled="priceSaving || pricePointsLoading || !selectedPricePoint"
              class="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {{ priceSaving ? '儲存中...' : '儲存價格' }}
            </button>
          </div>
          <p class="text-xs text-gray-500 mt-2">Apple 會依所選價格點自動換算其他地區。</p>
        </div>
      </div>

      <!-- All territory prices -->
      <div class="px-6 pb-2 shrink-0 border-t border-[#393b40] pt-4">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-medium text-gray-300">Country or Region Prices</h4>
          <div class="flex items-center gap-3">
            <input
              v-model="priceSearch"
              type="text"
              class="px-2 py-1 bg-[#1e1f22] border border-[#43454a] rounded text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500 w-40"
              placeholder="搜尋地區..."
            />
            <button
              v-if="!allPricesLoading"
              @click="loadAllTerritoryPrices"
              class="px-2 py-1 border border-[#43454a] rounded text-xs text-gray-300 hover:bg-[#393b40] transition-colors"
            >
              重新載入
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between mt-1">
          <p v-if="allPricesData" class="text-xs text-gray-500">
            Base Country or Region: {{ territoryName(allPricesData.baseTerritory) }} ({{ allPricesData.baseCurrency }}) - {{ allPricesData.basePrice }}
          </p>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="priceOnlyAvailable" class="rounded w-3 h-3" />
            <span class="text-xs text-gray-400">只顯示已上架地區</span>
          </label>
        </div>
      </div>

      <div class="flex-1 min-h-0 px-6 pb-4">
        <div v-if="allPricesLoading" class="text-center py-6 text-gray-500">載入地區價格中...</div>
        <div v-else-if="filteredPrices.length > 0" class="bg-[#1e1f22] rounded-lg border border-[#393b40] overflow-hidden h-full flex flex-col">
          <div class="shrink-0 pr-[6px]">
          <table class="w-full">
            <thead>
              <tr class="border-b border-[#393b40]">
                <th class="text-left px-3 py-2 text-xs font-medium text-gray-500">Country or Region</th>
                <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 w-[20%]">Price</th>
                <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 w-[20%]">Proceeds</th>
                <th class="w-5"></th>
              </tr>
            </thead>
          </table>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <table class="w-full">
              <tbody>
                <tr
                  v-for="tp in filteredPrices"
                  :key="tp.territory"
                  class="border-b border-[#393b40] last:border-0"
                  :class="tp.territory === allPricesData?.baseTerritory ? 'bg-blue-600/10' : tp.isManual ? 'bg-yellow-600/10' : ''"
                >
                  <td class="px-3 py-1.5 text-sm text-gray-300">{{ territoryName(tp.territory) }} ({{ tp.currency }})</td>
                  <td class="px-3 py-1.5 text-sm text-gray-200 font-mono w-[20%]">{{ tp.customerPrice }}</td>
                  <td class="px-3 py-1.5 text-sm text-gray-400 font-mono w-[20%]">{{ tp.proceeds }}</td>
                  <td class="py-1.5 w-5 text-center">
                    <button
                      v-if="tp.territory !== allPricesData?.baseTerritory"
                      @click="openEditTerritoryPrice(tp)"
                      class="text-gray-500 hover:text-blue-400 transition-colors"
                      title="修改價格"
                    >&#9998;</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-else-if="allPricesData && priceSearch" class="text-sm text-gray-500 text-center py-4">找不到符合的地區</p>
        <p v-else-if="!allPricesLoading" class="text-sm text-gray-500 text-center py-6">尚未設定價格</p>
      </div>

      <!-- Edit territory price modal -->
      <div v-if="editingTerrPrice" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="editingTerrPrice = null">
        <div class="bg-[#2b2d30] rounded-xl shadow-xl p-6 w-full max-w-md border border-[#393b40] titlebar-no-drag">
          <div class="flex items-center justify-between mb-4">
            <h4 class="text-base font-semibold text-gray-100">
              修改價格 — {{ territoryName(editingTerrPrice.territory) }} ({{ editingTerrPrice.currency }})
            </h4>
            <button @click="editingTerrPrice = null" class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors">&times;</button>
          </div>
          <div v-if="editTerrPriceLoading" class="text-center py-6 text-gray-500">載入價格選項中...</div>
          <template v-else>
            <div class="mb-4">
              <SearchableSelect
                v-model="editTerrSelectedPP"
                :options="editTerrPPOptions"
                placeholder="選擇價格..."
              />
            </div>
            <div class="flex justify-end gap-2">
              <button @click="editingTerrPrice = null" class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors">取消</button>
              <button
                @click="saveEditTerritoryPrice"
                :disabled="editTerrSaving || !editTerrSelectedPP"
                class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {{ editTerrSaving ? '儲存中...' : '儲存' }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
