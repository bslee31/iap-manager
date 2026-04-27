<script setup lang="ts">
import { ref } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { statusLabel, statusColor } from '../../../utils/google-product-status'
import SearchableSelect from '../../common/SearchableSelect.vue'
import * as googleApi from '../../../services/api/google'

interface PurchaseOption {
  purchaseOptionId: string
  state: string
  type: 'BUY' | 'RENT' | 'UNKNOWN'
  legacyCompatible: boolean
  regionalConfigs: {
    regionCode: string
    availability: string
    price?: { currencyCode: string; units: string; nanos: number }
  }[]
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

const notify = useNotificationStore()

function currencyForRegion(code: string): string {
  return props.supportedRegions.find((r) => r.regionCode === code)?.currencyCode || ''
}

function availableRegionCount(po: PurchaseOption): number {
  return po.regionalConfigs.filter((c) => c.availability === 'AVAILABLE').length
}

// Formatted base-region price for a PO, suitable for inline display in the
// Purchase Options list. Uses "amount currency" order (e.g. "200.00 TWD")
// to match the product list Price column.
function basePriceLabel(po: PurchaseOption): string {
  if (!props.baseRegion) return ''
  const cfg = po.regionalConfigs.find((c) => c.regionCode === props.baseRegion)
  if (!cfg?.price) return ''
  const whole = cfg.price.units || '0'
  const frac = Math.round((cfg.price.nanos || 0) / 1e7)
    .toString()
    .padStart(2, '0')
  return `${whole}.${frac} ${cfg.price.currencyCode}`
}

function parsePriceToUnitsNanos(input: string): { units: string; nanos: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [intPart, fracPart = ''] = trimmed.split('.')
  const paddedFrac = (fracPart + '000000000').slice(0, 9)
  return { units: intPart, nanos: Number(paddedFrac) }
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
    baseRegionCode: props.baseRegion || '',
    basePrice: ''
  }
  showAddPoForm.value = true
}

function cancelAddPoForm() {
  showAddPoForm.value = false
}

async function saveNewPurchaseOption() {
  const id = newPo.value.purchaseOptionId.trim()
  if (!id) {
    notify.error('請輸入 Purchase Option ID')
    return
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    notify.error('Purchase Option ID 必須以小寫英數開頭，只能含小寫英數和 -')
    return
  }
  if (props.detail.purchaseOptions.some((po) => po.purchaseOptionId === id)) {
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
  const result = await googleApi.addPurchaseOption(
    props.projectId,
    props.productId,
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
    emit('updated')
  } else {
    notify.error(result.error || '新增失敗')
  }
}

// ── Set as Backwards compatible ──
const settingLegacyPoId = ref('')

async function setAsBackwardsCompatible(po: PurchaseOption) {
  if (po.legacyCompatible) return
  if (po.type !== 'BUY') {
    notify.error('只有 BUY 型方案可以設為主方案')
    return
  }
  const confirmMsg =
    `將「${po.purchaseOptionId}」設為主方案（Backwards compatible）？\n\n` +
    `設定後，使用舊版 Billing Library（v5 以前）的 client 會看到這個方案的定價。` +
    `原本的主方案會失去此標記，但其狀態（上架/下架）不變。`
  if (!confirm(confirmMsg)) return

  settingLegacyPoId.value = po.purchaseOptionId
  const result = await googleApi.setLegacyCompatible(
    props.projectId,
    props.productId,
    po.purchaseOptionId
  )
  settingLegacyPoId.value = ''
  if (result.success) {
    notify.success(`「${po.purchaseOptionId}」已設為主方案`)
    emit('updated')
  } else {
    notify.error(result.error || '設定失敗')
  }
}

// ── Purchase option state toggle ──
const togglingPoId = ref('')

async function togglePurchaseOptionState(po: PurchaseOption) {
  const willActivate = po.state !== 'ACTIVE'
  const label = willActivate ? '上架' : '下架'
  if (!confirm(`確定要${label}方案「${po.purchaseOptionId}」嗎？`)) return

  togglingPoId.value = po.purchaseOptionId
  const result = await googleApi.setPurchaseOptionState(
    props.projectId,
    props.productId,
    po.purchaseOptionId,
    willActivate
  )
  togglingPoId.value = ''
  if (result.success) {
    notify.success(`方案已${label}`)
    emit('updated')
  } else {
    notify.error(result.error || `${label}失敗`)
  }
}
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
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
            <span v-if="basePriceLabel(po)" class="text-xs text-gray-300 font-mono">
              · {{ basePriceLabel(po) }}
            </span>
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
              v-if="!po.legacyCompatible && po.type === 'BUY'"
              @click="setAsBackwardsCompatible(po)"
              :disabled="settingLegacyPoId === po.purchaseOptionId"
              class="text-xs px-2 py-1 border border-[#43454a] text-gray-300 hover:bg-[#393b40] rounded transition-colors disabled:opacity-50"
            >
              {{ settingLegacyPoId === po.purchaseOptionId ? '...' : '設為主方案' }}
            </button>
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
              maxlength="63"
              placeholder="例如：premium"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500 font-mono"
            />
            <p class="text-xs text-gray-500 mt-1">
              以小寫英數開頭，只能含小寫英數和 -（不可有 _ 或 .）；建立後無法修改
            </p>
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
  </div>
</template>
