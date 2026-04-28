<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../../stores/notification.store'
import { statusColor } from '../../../utils/google-product-status'
import SearchableSelect from '../../common/SearchableSelect.vue'
import * as googleApi from '../../../services/api/google'

const { t, te } = useI18n()

function statusLabel(status: string): string {
  const key = `google.status.${status}`
  return te(key) ? t(key) : status
}

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
    notify.error(t('google.detail.purchaseOptions.toast.poIdRequired'))
    return
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    notify.error(t('google.detail.purchaseOptions.toast.poIdInvalid'))
    return
  }
  if (props.detail.purchaseOptions.some((po) => po.purchaseOptionId === id)) {
    notify.error(t('google.detail.purchaseOptions.toast.poIdExists'))
    return
  }
  if (!newPo.value.baseRegionCode) {
    notify.error(t('google.detail.purchaseOptions.toast.regionRequired'))
    return
  }
  const currency = currencyForRegion(newPo.value.baseRegionCode)
  if (!currency) {
    notify.error(t('google.detail.purchaseOptions.toast.currencyMissing'))
    return
  }
  const parsed = parsePriceToUnitsNanos(newPo.value.basePrice)
  if (!parsed) {
    notify.error(t('google.detail.purchaseOptions.toast.priceRequired'))
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
    const skipped = (result as { skippedRegions?: string[] }).skippedRegions
    if (skipped && skipped.length > 0) {
      notify.success(
        t('google.detail.purchaseOptions.toast.addSuccessSkipped', {
          count: skipped.length,
          regions: skipped.join(', ')
        })
      )
    } else {
      notify.success(t('google.detail.purchaseOptions.toast.addSuccess'))
    }
    showAddPoForm.value = false
    emit('updated')
  } else {
    notify.error(result.error || t('google.detail.purchaseOptions.toast.addFail'))
  }
}

// ── Set as Backwards compatible ──
const settingLegacyPoId = ref('')

async function setAsBackwardsCompatible(po: PurchaseOption) {
  if (po.legacyCompatible) return
  if (po.type !== 'BUY') {
    notify.error(t('google.detail.purchaseOptions.primaryNonBuy'))
    return
  }
  if (!confirm(t('google.detail.purchaseOptions.primaryConfirm', { poId: po.purchaseOptionId })))
    return

  settingLegacyPoId.value = po.purchaseOptionId
  const result = await googleApi.setLegacyCompatible(
    props.projectId,
    props.productId,
    po.purchaseOptionId
  )
  settingLegacyPoId.value = ''
  if (result.success) {
    notify.success(
      t('google.detail.purchaseOptions.toast.primarySuccess', { poId: po.purchaseOptionId })
    )
    emit('updated')
  } else {
    notify.error(result.error || t('google.detail.purchaseOptions.toast.primaryFail'))
  }
}

// ── Purchase option state toggle ──
const togglingPoId = ref('')

async function togglePurchaseOptionState(po: PurchaseOption) {
  const willActivate = po.state !== 'ACTIVE'
  // Per-PO toggles use the single-word verbs (`google.action.*`), not the
  // batch-prefixed ones — confirm / button / toast all say 「上架」 / 「下架」
  // rather than 「批次上架」 / 「批次下架」.
  const label = willActivate ? t('google.action.activate') : t('google.action.deactivate')
  if (
    !confirm(
      t('google.detail.purchaseOptions.toggleConfirm', {
        label,
        poId: po.purchaseOptionId
      })
    )
  )
    return

  togglingPoId.value = po.purchaseOptionId
  const result = await googleApi.setPurchaseOptionState(
    props.projectId,
    props.productId,
    po.purchaseOptionId,
    willActivate
  )
  togglingPoId.value = ''
  if (result.success) {
    notify.success(t('google.detail.purchaseOptions.toast.toggleSuccess', { label }))
    emit('updated')
  } else {
    notify.error(result.error || t('google.detail.purchaseOptions.toast.toggleFail', { label }))
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center justify-between px-6 pt-4 pb-3">
      <span class="text-sm text-gray-400">{{
        t('google.detail.purchaseOptions.summary', { count: detail.purchaseOptions.length })
      }}</span>
      <button
        class="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-700"
        @click="openAddPoForm"
      >
        {{ t('google.detail.purchaseOptions.addPo') }}
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
      <div v-if="detail.purchaseOptions.length === 0" class="py-10 text-center text-gray-500">
        {{ t('google.detail.purchaseOptions.empty') }}
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="po in detail.purchaseOptions"
          :key="po.purchaseOptionId"
          class="flex items-center justify-between gap-3 rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-3"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="font-mono text-sm text-gray-200">{{ po.purchaseOptionId }}</span>
            <span class="text-xs text-gray-500">{{ po.type }}</span>
            <span v-if="basePriceLabel(po)" class="font-mono text-xs text-gray-300">
              · {{ basePriceLabel(po) }}
            </span>
            <span class="text-xs text-gray-500">
              ·
              {{
                t('google.detail.purchaseOptions.regionsCount', {
                  count: availableRegionCount(po)
                })
              }}
            </span>
            <span
              v-if="po.legacyCompatible"
              class="rounded-full bg-blue-600/20 px-2 py-0.5 text-xs text-blue-400"
            >
              {{ t('google.detail.purchaseOptions.backwardsCompatible') }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-xs" :class="statusColor(po.state)">
              {{ statusLabel(po.state) }}
            </span>
            <button
              v-if="!po.legacyCompatible && po.type === 'BUY'"
              :disabled="settingLegacyPoId === po.purchaseOptionId"
              class="rounded border border-[#43454a] px-2 py-1 text-xs text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
              @click="setAsBackwardsCompatible(po)"
            >
              {{
                settingLegacyPoId === po.purchaseOptionId
                  ? '...'
                  : t('google.detail.purchaseOptions.setAsPrimary')
              }}
            </button>
            <button
              v-if="po.state === 'ACTIVE'"
              :disabled="togglingPoId === po.purchaseOptionId"
              class="rounded bg-red-600 px-2 py-1 text-xs text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              @click="togglePurchaseOptionState(po)"
            >
              {{ togglingPoId === po.purchaseOptionId ? '...' : t('google.action.deactivate') }}
            </button>
            <button
              v-else
              :disabled="togglingPoId === po.purchaseOptionId"
              class="rounded bg-green-600 px-2 py-1 text-xs text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              @click="togglePurchaseOptionState(po)"
            >
              {{ togglingPoId === po.purchaseOptionId ? '...' : t('google.action.activate') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Purchase Option Dialog -->
    <div
      v-if="showAddPoForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="cancelAddPoForm"
    >
      <div
        class="titlebar-no-drag flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-[#393b40] bg-[#2b2d30] shadow-xl"
      >
        <div class="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h3 class="text-lg font-semibold text-gray-100">
            {{ t('google.detail.purchaseOptions.addDialogTitle') }}
          </h3>
          <button
            class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
            @click="cancelAddPoForm"
          >
            &times;
          </button>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">Purchase Option ID</label>
            <input
              v-model="newPo.purchaseOptionId"
              type="text"
              maxlength="63"
              :placeholder="t('google.detail.purchaseOptions.addPoIdPlaceholder')"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 font-mono text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
            />
            <p class="mt-1 text-xs text-gray-500">
              {{ t('google.detail.purchaseOptions.addPoIdHint') }}
            </p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('google.detail.purchaseOptions.baseRegionLabel')
            }}</label>
            <SearchableSelect
              v-model="newPo.baseRegionCode"
              :options="regionOptionsForEdit"
              :placeholder="t('google.detail.purchaseOptions.baseRegionPlaceholder')"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('google.detail.purchaseOptions.basePriceLabel')
            }}</label>
            <div class="flex items-center gap-2">
              <input
                v-model="newPo.basePrice"
                type="text"
                inputmode="decimal"
                placeholder="0"
                class="flex-1 rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
              />
              <span class="min-w-[3.5rem] text-center text-sm text-gray-400">
                {{ currencyForRegion(newPo.baseRegionCode) || '---' }}
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-500">
              {{ t('google.detail.purchaseOptions.addAutoConvertHint') }}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 justify-end gap-2 border-t border-[#393b40] px-6 py-4">
          <button
            class="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-[#393b40]"
            @click="cancelAddPoForm"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            :disabled="addPoSaving"
            class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            @click="saveNewPurchaseOption"
          >
            {{
              addPoSaving
                ? t('google.detail.purchaseOptions.addingButton')
                : t('google.detail.purchaseOptions.addButton')
            }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
