<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../../stores/notification.store'
import { useAppleProductsStore } from '../../../stores/apple-products.store'
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

const { t } = useI18n()
const notify = useNotificationStore()
const store = useAppleProductsStore()

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
    label: `${pp.customerPrice} (${t('apple.detail.price.proceedsLabel')}: ${pp.proceeds})`
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
    result = result.filter(
      (tp) =>
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
    const currentPrice = allPricesData.value?.territoryPrices.find(
      (p) => p.territory === tp.territory
    )
    if (currentPrice) {
      const match = result.data.find(
        (pp: PricePoint) => pp.customerPrice === currentPrice.customerPrice
      )
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
    notify.success(
      t('apple.detail.price.toast.updateRegionSuccess', {
        region: territoryName(editingTerrPrice.value.territory)
      })
    )
    editingTerrPrice.value = null
    await loadAllTerritoryPrices()
  } else {
    notify.error(result.error || t('apple.detail.price.toast.updateFail'))
  }
}

const editTerrPPOptions = computed(() => {
  const baseCurrency = allPricesData.value?.baseCurrency || ''
  const currentPrice = editingTerrPrice.value
    ? allPricesData.value?.territoryPrices.find(
        (p) => p.territory === editingTerrPrice.value!.territory
      )?.customerPrice
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
      const match = result.data.find(
        (pp: PricePoint) => pp.customerPrice === allPricesData.value!.basePrice
      )
      if (match) selectedPricePoint.value = match.id
    }
  }
  pricePointsLoading.value = false
}

async function savePriceSchedule() {
  if (!selectedPricePoint.value) {
    notify.error(t('apple.detail.price.toast.missingPricePoint'))
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
    notify.success(t('apple.detail.price.toast.updateSuccess'))
    await Promise.all([loadPriceSchedule(), loadAllTerritoryPrices()])
    if (allPricesData.value) {
      store.updateProductPrice(allPricesData.value.basePrice, allPricesData.value.baseCurrency)
    }
  } else {
    notify.error(result.error || t('apple.detail.price.toast.updateFail'))
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
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="priceLoading" class="py-10 text-center text-gray-500">{{ t('common.loading') }}</div>
    <template v-else>
      <!-- Set base price -->
      <div class="shrink-0 px-6 pt-4 pb-3">
        <div class="rounded-lg border border-[#43454a] bg-[#1e1f22] p-3">
          <div class="mb-2 text-xs font-medium text-gray-500 uppercase">
            {{ t('apple.detail.price.adjustBase') }}
          </div>
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <label class="mb-1 block text-xs text-gray-500">{{
                t('apple.detail.price.baseRegion')
              }}</label>
              <SearchableSelect
                v-model="selectedTerritory"
                :options="territoryOptions.map((opt) => ({ value: opt.code, label: opt.label }))"
                :placeholder="t('apple.detail.price.baseRegionPlaceholder')"
              />
            </div>
            <div class="min-w-0 flex-1">
              <label class="mb-1 block text-xs text-gray-500">{{
                t('apple.detail.price.priceLabel')
              }}</label>
              <SearchableSelect
                v-model="selectedPricePoint"
                :options="pricePointOptions"
                :placeholder="
                  pricePointsLoading
                    ? t('apple.detail.price.loadingPricePoints')
                    : t('apple.detail.price.pricePlaceholder')
                "
              />
            </div>
            <button
              :disabled="priceSaving || pricePointsLoading || !selectedPricePoint"
              class="rounded-lg bg-blue-600 px-4 py-1.5 text-sm whitespace-nowrap text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              @click="savePriceSchedule"
            >
              {{ priceSaving ? t('common.saving') : t('apple.detail.price.saveButton') }}
            </button>
          </div>
          <p class="mt-2 text-xs text-gray-500">{{ t('apple.detail.price.autoConvertHint') }}</p>
        </div>
      </div>

      <!-- All territory prices -->
      <div class="shrink-0 border-t border-[#393b40] px-6 pt-4 pb-2">
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-medium text-gray-300">
            {{ t('apple.detail.price.regionPrices') }}
          </h4>
          <div class="flex items-center gap-3">
            <input
              v-model="priceSearch"
              type="text"
              class="w-40 rounded border border-[#43454a] bg-[#1e1f22] px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              :placeholder="t('apple.detail.price.searchPlaceholder')"
            />
            <button
              v-if="!allPricesLoading"
              class="rounded border border-[#43454a] px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-[#393b40]"
              @click="loadAllTerritoryPrices"
            >
              {{ t('common.reload') }}
            </button>
          </div>
        </div>
        <div class="mt-1 flex items-center justify-between">
          <p v-if="allPricesData" class="text-xs text-gray-500">
            {{
              t('apple.detail.price.baseLabel', {
                region: territoryName(allPricesData.baseTerritory),
                currency: allPricesData.baseCurrency,
                price: allPricesData.basePrice
              })
            }}
          </p>
          <label class="flex cursor-pointer items-center gap-1.5">
            <input v-model="priceOnlyAvailable" type="checkbox" class="h-3 w-3 rounded" />
            <span class="text-xs text-gray-400">{{ t('apple.detail.price.onlyAvailable') }}</span>
          </label>
        </div>
      </div>

      <div class="min-h-0 flex-1 px-6 pb-4">
        <div v-if="allPricesLoading" class="py-6 text-center text-gray-500">
          {{ t('apple.detail.price.loading') }}
        </div>
        <div
          v-else-if="filteredPrices.length > 0"
          class="flex h-full flex-col overflow-hidden rounded-lg border border-[#393b40] bg-[#1e1f22]"
        >
          <div class="shrink-0 pr-[6px]">
            <table class="w-full">
              <thead>
                <tr class="border-b border-[#393b40]">
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500">
                    Country or Region
                  </th>
                  <th class="w-[20%] px-3 py-2 text-left text-xs font-medium text-gray-500">
                    Price
                  </th>
                  <th class="w-[20%] px-3 py-2 text-left text-xs font-medium text-gray-500">
                    Proceeds
                  </th>
                  <th class="w-5"></th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <table class="w-full">
              <tbody>
                <tr
                  v-for="tp in filteredPrices"
                  :key="tp.territory"
                  class="border-b border-[#393b40] last:border-0"
                  :class="
                    tp.territory === allPricesData?.baseTerritory
                      ? 'bg-blue-600/10'
                      : tp.isManual
                        ? 'bg-yellow-600/10'
                        : ''
                  "
                >
                  <td class="px-3 py-1.5 text-sm text-gray-300">
                    {{ territoryName(tp.territory) }} ({{ tp.currency }})
                  </td>
                  <td class="w-[20%] px-3 py-1.5 font-mono text-sm text-gray-200">
                    {{ tp.customerPrice }}
                  </td>
                  <td class="w-[20%] px-3 py-1.5 font-mono text-sm text-gray-400">
                    {{ tp.proceeds }}
                  </td>
                  <td class="w-5 py-1.5 text-center">
                    <button
                      v-if="tp.territory !== allPricesData?.baseTerritory"
                      class="text-gray-500 transition-colors hover:text-blue-400"
                      :title="t('apple.detail.price.editTooltip')"
                      @click="openEditTerritoryPrice(tp)"
                    >
                      &#9998;
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-else-if="allPricesData && priceSearch" class="py-4 text-center text-sm text-gray-500">
          {{ t('apple.detail.price.noMatch') }}
        </p>
        <p v-else-if="!allPricesLoading" class="py-6 text-center text-sm text-gray-500">
          {{ t('apple.detail.price.noPrices') }}
        </p>
      </div>

      <!-- Edit territory price modal -->
      <div
        v-if="editingTerrPrice"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="editingTerrPrice = null"
      >
        <div
          class="titlebar-no-drag w-full max-w-md rounded-xl border border-[#393b40] bg-[#2b2d30] p-6 shadow-xl"
        >
          <div class="mb-4 flex items-center justify-between">
            <h4 class="text-base font-semibold text-gray-100">
              {{
                t('apple.detail.price.editTitle', {
                  region: territoryName(editingTerrPrice.territory),
                  currency: editingTerrPrice.currency
                })
              }}
            </h4>
            <button
              class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
              @click="editingTerrPrice = null"
            >
              &times;
            </button>
          </div>
          <div v-if="editTerrPriceLoading" class="py-6 text-center text-gray-500">
            {{ t('apple.detail.price.loadingPricePoints') }}
          </div>
          <template v-else>
            <div class="mb-4">
              <SearchableSelect
                v-model="editTerrSelectedPP"
                :options="editTerrPPOptions"
                :placeholder="t('apple.detail.price.pricePlaceholder')"
              />
            </div>
            <div class="flex justify-end gap-2">
              <button
                class="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-[#393b40]"
                @click="editingTerrPrice = null"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                :disabled="editTerrSaving || !editTerrSelectedPP"
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                @click="saveEditTerritoryPrice"
              >
                {{ editTerrSaving ? t('common.saving') : t('common.save') }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
