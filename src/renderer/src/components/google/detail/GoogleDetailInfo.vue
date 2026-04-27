<script setup lang="ts">
import { computed } from 'vue'
import { statusLabel, statusColor } from '../../../utils/google-product-status'

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
    return `${active}/${total} 上架中`
  }
  return statusLabel(derivedStatus.value)
})
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6 space-y-5">
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
</template>
