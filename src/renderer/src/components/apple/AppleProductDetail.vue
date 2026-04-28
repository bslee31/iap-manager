<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../stores/notification.store'
import { useAppleProductsStore } from '../../stores/apple-products.store'
import AppleDetailInfo from './detail/AppleDetailInfo.vue'
import AppleDetailAvailability from './detail/AppleDetailAvailability.vue'
import AppleDetailPrice from './detail/AppleDetailPrice.vue'
import AppleDetailLocalization from './detail/AppleDetailLocalization.vue'
import * as appleApi from '../../services/api/apple'

const props = defineProps<{ projectId: string }>()
defineEmits<{ close: [] }>()

const { t } = useI18n()
const notify = useNotificationStore()
const store = useAppleProductsStore()

// AppleProductTable wraps this component in v-if="store.selectedProduct",
// so the ref is non-null for the entire mounted lifetime.
const product = computed(() => store.selectedProduct!)

type Tab = 'info' | 'availability' | 'price' | 'localization'
const activeTab = ref<Tab>('info')

// Availability data lives on this Detail component because both the
// Availability tab (read/write) and the Price tab (read-only filter
// "only show available") need it. Loaded once on open, refreshed only
// via the Availability tab's own save call.
const availLoading = ref(false)
const allTerritories = ref<{ id: string; currency: string }[]>([])
const selectedTerritories = ref<Set<string>>(new Set())
const availableInNewTerritories = ref(false)

async function loadAvailability(): Promise<void> {
  if (availLoading.value) return
  availLoading.value = true
  try {
    const [availResult, terrResult] = await Promise.all([
      appleApi.getAvailabilityDetail(props.projectId, product.value.id),
      appleApi.getAllTerritories(props.projectId)
    ])
    if (availResult.success) {
      availableInNewTerritories.value = availResult.data.availableInNewTerritories
      selectedTerritories.value = new Set(availResult.data.territoryIds)
    }
    if (terrResult.success) {
      allTerritories.value = terrResult.data
    }
  } catch {
    notify.error(t('apple.detail.availability.loadFail'))
  }
  availLoading.value = false
}

// Safety net: if the user clicks into Availability or Price before the
// initial onMounted load finished, kick the load.
watch(activeTab, (tab) => {
  if ((tab === 'availability' || tab === 'price') && allTerritories.value.length === 0) {
    loadAvailability()
  }
})

onMounted(loadAvailability)
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
    @click.self="$emit('close')"
  >
    <div
      class="titlebar-no-drag flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#393b40] bg-[#2b2d30] shadow-xl"
    >
      <!-- Header -->
      <div class="flex shrink-0 items-center justify-between border-b border-[#393b40] px-6 py-4">
        <div>
          <h3 class="text-lg font-semibold text-gray-100">{{ product.referenceName }}</h3>
          <p class="font-mono text-sm text-gray-400">{{ product.productId }}</p>
        </div>
        <button
          class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
          @click="$emit('close')"
        >
          &times;
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex shrink-0 border-b border-[#393b40] px-6">
        <button
          v-for="tab in ['info', 'availability', 'price', 'localization'] as Tab[]"
          :key="tab"
          class="-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
          :class="
            activeTab === tab
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          "
          @click="activeTab = tab"
        >
          {{ t(`apple.detail.tabs.${tab}`) }}
        </button>
      </div>

      <!-- Tab content (KeepAlive preserves per-tab state across switches:
           e.g. price-tab search input, availability-tab collapsed regions) -->
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <KeepAlive>
          <AppleDetailInfo
            v-if="activeTab === 'info'"
            :project-id="projectId"
            :iap-id="product.id"
            :product-id="product.productId"
            :type="product.type"
            :state="product.state"
            :reference-name="product.referenceName"
          />
          <AppleDetailAvailability
            v-else-if="activeTab === 'availability'"
            v-model:selected-territories="selectedTerritories"
            v-model:available-in-new="availableInNewTerritories"
            :project-id="projectId"
            :iap-id="product.id"
            :loading="availLoading"
            :all-territories="allTerritories"
          />
          <AppleDetailPrice
            v-else-if="activeTab === 'price'"
            :project-id="projectId"
            :iap-id="product.id"
            :all-territories="allTerritories"
            :selected-territories="selectedTerritories"
          />
          <AppleDetailLocalization v-else :project-id="projectId" :iap-id="product.id" />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
