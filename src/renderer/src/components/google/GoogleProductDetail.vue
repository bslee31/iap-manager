<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import GoogleDetailInfo from './detail/GoogleDetailInfo.vue'
import GoogleDetailPurchaseOptions from './detail/GoogleDetailPurchaseOptions.vue'
import GoogleDetailPricing from './detail/GoogleDetailPricing.vue'
import GoogleDetailListings from './detail/GoogleDetailListings.vue'

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
interface RegionInfo {
  regionCode: string
  currencyCode: string
}

const detail = ref<ProductDetail | null>(null)
const loading = ref(false)
const baseRegion = ref('')
const defaultLanguage = ref('')
const supportedRegions = ref<RegionInfo[]>([])
const selectedPoId = ref('')

// Header title. Picks the listing using the project's configured
// defaultLanguage, then falls back to the first listing — no hardcoded
// locale. Updates reactively when the user edits listings inside this modal.
const displayName = computed(() => {
  const listings = detail.value?.listings || []
  if (listings.length > 0) {
    const pick =
      (defaultLanguage.value &&
        listings.find((l) => l.languageCode === defaultLanguage.value)) ||
      listings[0]
    if (pick?.title) return pick.title
  }
  return props.product.name || ''
})

const regionDisplay = new Intl.DisplayNames(['en'], { type: 'region' })
const regionOptionsForEdit = computed(() =>
  supportedRegions.value
    .map((r) => ({
      value: r.regionCode,
      label: regionDisplay.of(r.regionCode) || r.regionCode,
      right: `${r.regionCode} · ${r.currencyCode}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
)

// Derive a region code from a BCP-47 language tag (e.g. "zh-TW" -> "TW").
// Falls back to empty string when the tag has no country suffix.
function inferRegionFromLanguage(lang: string | null): string {
  if (!lang) return ''
  const parts = lang.split('-')
  const last = parts[parts.length - 1]
  return last.length === 2 ? last.toUpperCase() : ''
}

async function loadDetail(): Promise<void> {
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
      // Reset to first PO on every reload — matches original behaviour.
      // The Pricing tab's watch on selectedPoId resyncs its form.
      selectedPoId.value = detail.value.purchaseOptions[0].purchaseOptionId
    }
  } else {
    notify.error(detailResult.error || '載入失敗')
  }
  if (settingsResult.success && settingsResult.data) {
    baseRegion.value =
      settingsResult.data.baseRegion ||
      inferRegionFromLanguage(settingsResult.data.defaultLanguage)
    defaultLanguage.value = settingsResult.data.defaultLanguage || ''
  }
  if (regionsResult.success && regionsResult.data) {
    supportedRegions.value = regionsResult.data
  }
}

function onChildUpdated(): void {
  loadDetail()
  emit('updated')
}

onMounted(loadDetail)
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-40" @click.self="emit('close')">
    <div class="bg-[#2b2d30] rounded-xl shadow-xl w-full max-w-3xl h-[85vh] border border-[#393b40] flex flex-col overflow-hidden titlebar-no-drag">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#393b40] shrink-0">
        <div>
          <h3 class="text-lg font-semibold text-gray-100">{{ displayName || product.productId }}</h3>
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

      <!-- Tab content (KeepAlive preserves per-tab UI state across switches) -->
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-500">載入中...</div>
        <KeepAlive v-else-if="detail">
          <GoogleDetailInfo
            v-if="activeTab === 'info'"
            :detail="detail"
          />
          <GoogleDetailPurchaseOptions
            v-else-if="activeTab === 'purchaseOptions'"
            :project-id="projectId"
            :product-id="product.productId"
            :detail="detail"
            :base-region="baseRegion"
            :supported-regions="supportedRegions"
            :region-options-for-edit="regionOptionsForEdit"
            @updated="onChildUpdated"
          />
          <GoogleDetailPricing
            v-else-if="activeTab === 'pricing'"
            :project-id="projectId"
            :product-id="product.productId"
            :detail="detail"
            :base-region="baseRegion"
            :supported-regions="supportedRegions"
            :region-options-for-edit="regionOptionsForEdit"
            v-model:selected-po-id="selectedPoId"
            @updated="onChildUpdated"
          />
          <GoogleDetailListings
            v-else
            :project-id="projectId"
            :product-id="product.productId"
            :detail="detail"
            @updated="onChildUpdated"
          />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
