<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../stores/notification.store'
import { useGoogleProductsStore } from '../../stores/google-products.store'
import GoogleDetailInfo from './detail/GoogleDetailInfo.vue'
import GoogleDetailPurchaseOptions from './detail/GoogleDetailPurchaseOptions.vue'
import GoogleDetailPricing from './detail/GoogleDetailPricing.vue'
import GoogleDetailListings from './detail/GoogleDetailListings.vue'
import * as googleApi from '../../services/api/google'

const props = defineProps<{ projectId: string }>()
defineEmits<{ close: [] }>()

const { t } = useI18n()
const notify = useNotificationStore()
const store = useGoogleProductsStore()

// GoogleProductTable wraps this component in v-if="store.selectedProduct",
// so the ref is non-null for the entire mounted lifetime.
const product = computed(() => store.selectedProduct!)

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
      (defaultLanguage.value && listings.find((l) => l.languageCode === defaultLanguage.value)) ||
      listings[0]
    if (pick?.title) return pick.title
  }
  return product.value.name || ''
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
    googleApi.getProductDetail(props.projectId, product.value.productId),
    googleApi.getSettings(props.projectId),
    googleApi.getRegions(props.projectId)
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
    notify.error(detailResult.error || t('common.error'))
  }
  if (settingsResult.success && settingsResult.data) {
    baseRegion.value =
      settingsResult.data.baseRegion || inferRegionFromLanguage(settingsResult.data.defaultLanguage)
    defaultLanguage.value = settingsResult.data.defaultLanguage || ''
  }
  if (regionsResult.success && regionsResult.data) {
    supportedRegions.value = regionsResult.data
  }
}

// Child tabs emit 'updated' after a successful save. We reload the detail
// view here, then resync the table list via the store so the row reflects
// the new state without leaving the modal.
function onChildUpdated(): void {
  loadDetail()
  store.syncProducts(props.projectId)
}

onMounted(loadDetail)
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
    @click.self="$emit('close')"
  >
    <div
      class="titlebar-no-drag border-divider bg-card flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-xl"
    >
      <!-- Header -->
      <div class="border-divider flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div>
          <h3 class="text-lg font-semibold text-gray-100">
            {{ displayName || product.productId }}
          </h3>
          <p class="font-mono text-sm text-gray-400">{{ product.productId }}</p>
        </div>
        <button
          class="hover:bg-divider rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:text-gray-300"
          @click="$emit('close')"
        >
          &times;
        </button>
      </div>

      <!-- Tabs -->
      <div class="border-divider flex shrink-0 border-b px-6">
        <button
          v-for="tab in ['info', 'purchaseOptions', 'pricing', 'listings'] as Tab[]"
          :key="tab"
          class="-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
          :class="
            activeTab === tab
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          "
          @click="activeTab = tab"
        >
          {{ t(`google.detail.tabs.${tab}`) }}
        </button>
      </div>

      <!-- Tab content (KeepAlive preserves per-tab UI state across switches) -->
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div v-if="loading" class="flex flex-1 items-center justify-center text-gray-500">
          {{ t('common.loading') }}
        </div>
        <KeepAlive v-else-if="detail">
          <GoogleDetailInfo v-if="activeTab === 'info'" :detail="detail" />
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
            v-model:selected-po-id="selectedPoId"
            :project-id="projectId"
            :product-id="product.productId"
            :detail="detail"
            :base-region="baseRegion"
            :supported-regions="supportedRegions"
            :region-options-for-edit="regionOptionsForEdit"
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
