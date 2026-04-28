<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { statusColor } from '../../../utils/google-product-status'

const { t, te } = useI18n()

interface PurchaseOption {
  purchaseOptionId: string
  state: string
  type: 'BUY' | 'RENT' | 'UNKNOWN'
  legacyCompatible: boolean
  regionalConfigs: unknown[]
}
interface ProductDetail {
  productId: string
  listings: { languageCode: string; title: string; description: string }[]
  purchaseOptions: PurchaseOption[]
}

const props = defineProps<{
  detail: ProductDetail
}>()

// Same priority-based aggregation as the list backend so toggling a PO state
// updates the badge without waiting for parent re-render:
// ACTIVE > INACTIVE/INACTIVE_PUBLISHED > DRAFT > NO_PURCHASE_OPTION.
const derivedStatus = computed(() => {
  const pos = props.detail.purchaseOptions
  if (pos.length === 0) return 'NO_PURCHASE_OPTION'
  if (pos.some((po) => po.state === 'ACTIVE')) return 'ACTIVE'
  if (pos.some((po) => po.state === 'INACTIVE' || po.state === 'INACTIVE_PUBLISHED')) {
    return 'INACTIVE'
  }
  return 'DRAFT'
})

const derivedStatusLabel = computed(() => {
  const pos = props.detail.purchaseOptions
  const total = pos.length
  const active = pos.filter((po) => po.state === 'ACTIVE').length
  if (total > 1 && active > 0 && active < total) {
    return t('google.statusMixed', { active, total })
  }
  const key = `google.status.${derivedStatus.value}`
  return te(key) ? t(key) : derivedStatus.value
})
</script>

<template>
  <div class="flex-1 space-y-5 overflow-y-auto p-6">
    <div>
      <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Product ID</label>
      <div
        class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 font-mono text-sm text-gray-400"
      >
        {{ detail.productId }}
      </div>
      <p class="mt-1 text-xs text-gray-500">{{ t('google.detail.info.idLockedHint') }}</p>
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Status</label>
      <div>
        <span
          class="inline-block rounded-full px-2 py-0.5 text-xs"
          :class="statusColor(derivedStatus)"
        >
          {{ derivedStatusLabel }}
        </span>
      </div>
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Purchase Options</label>
      <div class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-400">
        {{ t('google.detail.info.poCount', { count: detail.purchaseOptions.length }) }}
      </div>
    </div>
    <div>
      <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Listings</label>
      <div class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-400">
        {{ t('google.detail.info.listingCount', { count: detail.listings.length }) }}
      </div>
    </div>
  </div>
</template>
