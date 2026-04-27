<script setup lang="ts">
import { ref, computed, watch, onActivated, onDeactivated } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { statusLabel } from '../../../utils/google-product-status'
import SearchableSelect from '../../common/SearchableSelect.vue'
import * as googleApi from '../../../services/api/google'

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
  listings: { languageCode: string; title: string; description: string }[]
  purchaseOptions: PurchaseOption[]
}
interface RegionInfo {
  regionCode: string
  currencyCode: string
}

const props = defineProps<{
  projectId: string
  productId: string
  detail: ProductDetail
  baseRegion: string
  supportedRegions: RegionInfo[]
  regionOptionsForEdit: { value: string; label: string; right: string }[]
}>()

const emit = defineEmits<{
  updated: []
}>()

const selectedPoId = defineModel<string>('selectedPoId', { required: true })

const notify = useNotificationStore()

const regionDisplay = new Intl.DisplayNames(['en'], { type: 'region' })
function regionLabel(code: string): string {
  return regionDisplay.of(code) || code
}

function currencyForRegion(code: string): string {
  return props.supportedRegions.find((r) => r.regionCode === code)?.currencyCode || ''
}

function formatPrice(p?: RegionalConfig['price']): string {
  if (!p) return '-'
  const whole = p.units
  const frac = Math.round(p.nanos / 1e7)
    .toString()
    .padStart(2, '0')
  return `${p.currencyCode} ${whole}.${frac}`
}

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

const poOptions = computed(() =>
  props.detail.purchaseOptions.map((po) => ({
    value: po.purchaseOptionId,
    label: `${po.purchaseOptionId}`,
    right: `${po.type} · ${po.state}`
  }))
)
const selectedPo = computed(
  () =>
    props.detail.purchaseOptions.find((po) => po.purchaseOptionId === selectedPoId.value) || null
)

const regionSearch = ref('')
const filteredConfigs = computed(() => {
  if (!selectedPo.value) return []
  const list = [...selectedPo.value.regionalConfigs]
  // Sort: base region first, then alphabetical by display name.
  list.sort((a, b) => {
    if (props.baseRegion) {
      if (a.regionCode === props.baseRegion) return -1
      if (b.regionCode === props.baseRegion) return 1
    }
    return regionLabel(a.regionCode).localeCompare(regionLabel(b.regionCode), 'en')
  })
  const q = regionSearch.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (c) =>
      c.regionCode.toLowerCase().includes(q) || regionLabel(c.regionCode).toLowerCase().includes(q)
  )
})

// ── Price editing ──
const editRegion = ref('')
const editPrice = ref('')
const pricingSaving = ref(false)

function syncPricingForm() {
  if (!selectedPo.value) {
    editRegion.value = ''
    editPrice.value = ''
    return
  }
  const defaultRegion = props.baseRegion || selectedPo.value.regionalConfigs[0]?.regionCode || ''
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

// Resync when the selected PO changes — both via the selector here and via
// shell reload after a save (which can reset selectedPoId to the first PO).
watch(selectedPoId, () => syncPricingForm())

// Original behaviour reset regionSearch on every tab switch and re-synced
// the pricing form when entering the tab. Reproduce that under KeepAlive
// using the activated/deactivated hooks.
onActivated(() => {
  syncPricingForm()
})
onDeactivated(() => {
  regionSearch.value = ''
})

async function applyNewPricing() {
  if (!selectedPo.value) return
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
  if (
    !confirm(
      `確定要用 ${editRegion.value} ${currency} ${editPrice.value} 當基準，更新所有地區的價格嗎？`
    )
  )
    return

  pricingSaving.value = true
  const result = await googleApi.updatePurchaseOptionPricing(
    props.projectId,
    props.productId,
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
    emit('updated')
  } else {
    notify.error(result.error || '更新失敗')
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- Shared controls (PO selector + region search) -->
    <div class="shrink-0 px-6 pt-4">
      <div class="flex items-center gap-3">
        <div class="flex-1">
          <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">方案</label>
          <SearchableSelect
            v-if="poOptions.length > 1"
            v-model="selectedPoId"
            :options="poOptions"
            placeholder="選擇方案"
          />
          <div
            v-else-if="selectedPo"
            class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200"
          >
            {{ selectedPo.purchaseOptionId }}
            <span class="ml-2 text-xs text-gray-500"
              >{{ selectedPo.type }} · {{ statusLabel(selectedPo.state) }}</span
            >
          </div>
        </div>
        <div class="flex-1">
          <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">搜尋地區</label>
          <input
            v-model="regionSearch"
            type="text"
            placeholder="代碼或名稱"
            class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
          />
        </div>
      </div>
    </div>

    <!-- Pricing body -->
    <div class="flex min-h-0 flex-1 flex-col px-6 pt-4 pb-6">
      <div v-if="!selectedPo" class="py-10 text-center text-gray-500">沒有方案</div>
      <template v-else>
        <!-- Edit form -->
        <div class="mb-3 rounded-lg border border-[#43454a] bg-[#1e1f22] p-3">
          <div class="mb-2 text-xs font-medium text-gray-500 uppercase">調整基準定價</div>
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <label class="mb-1 block text-xs text-gray-500">基準國家</label>
              <SearchableSelect
                v-model="editRegion"
                :options="regionOptionsForEdit"
                placeholder="選擇基準國家"
              />
            </div>
            <div class="w-28 shrink-0">
              <label class="mb-1 block text-xs text-gray-500">價格</label>
              <input
                v-model="editPrice"
                type="text"
                inputmode="decimal"
                class="w-full rounded-lg border border-[#43454a] bg-[#2b2d30] px-3 py-1.5 text-sm text-gray-200 focus:ring-2 focus:ring-green-500 focus:outline-none"
                placeholder="0"
              />
            </div>
            <span class="min-w-[3.5rem] px-2 py-1.5 text-center text-sm text-gray-400">
              {{ currencyForRegion(editRegion) || '---' }}
            </span>
            <button
              @click="applyNewPricing"
              :disabled="pricingSaving"
              class="rounded-lg bg-green-600 px-4 py-1.5 text-sm whitespace-nowrap text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {{ pricingSaving ? '套用中...' : '套用新價格' }}
            </button>
          </div>
          <p class="mt-2 text-xs text-gray-500">
            套用後其他國家的價格由 Google 自動換算，將覆蓋目前所有地區的定價。
          </p>
        </div>
        <div
          class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#43454a] bg-[#1e1f22]"
        >
          <div class="shrink-0 pr-[6px]">
            <table class="w-full table-fixed text-sm">
              <colgroup>
                <col class="w-[50%]" />
                <col class="w-[20%]" />
                <col class="w-[30%]" />
              </colgroup>
              <thead>
                <tr
                  class="border-b border-[#393b40] bg-[#22252a] text-left text-xs text-gray-500 uppercase"
                >
                  <th class="px-3 py-2 font-medium">地區</th>
                  <th class="px-3 py-2 font-medium">代碼</th>
                  <th class="px-3 py-2 font-medium">價格</th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <table class="w-full table-fixed text-sm">
              <colgroup>
                <col class="w-[50%]" />
                <col class="w-[20%]" />
                <col class="w-[30%]" />
              </colgroup>
              <tbody>
                <tr
                  v-for="c in filteredConfigs"
                  :key="c.regionCode"
                  class="border-b border-[#393b40]/50 transition-colors hover:bg-[#2e3038]"
                  :class="{ 'bg-green-600/10': c.regionCode === baseRegion }"
                >
                  <td class="px-3 py-2 text-gray-200">
                    {{ regionLabel(c.regionCode) }}
                  </td>
                  <td class="px-3 py-2 font-mono text-gray-500">{{ c.regionCode }}</td>
                  <td class="px-3 py-2 font-mono text-gray-300">{{ formatPrice(c.price) }}</td>
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
  </div>
</template>
