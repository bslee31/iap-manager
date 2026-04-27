<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import AppleDetailInfo from './detail/AppleDetailInfo.vue'
import AppleDetailAvailability from './detail/AppleDetailAvailability.vue'
import AppleDetailPrice from './detail/AppleDetailPrice.vue'
import AppleDetailLocalization from './detail/AppleDetailLocalization.vue'
import * as appleApi from '../../services/api/apple'

const props = defineProps<{
  projectId: string
  product: {
    id: string
    productId: string
    referenceName: string
    type: string
    state: string
    territoryCount: number
  }
}>()

const emit = defineEmits<{
  close: []
  'update-availability': [count: number]
  'update-price': [price: string, currency: string]
  'update-reference-name': [referenceName: string]
}>()

const notify = useNotificationStore()

type Tab = 'info' | 'availability' | 'price' | 'localization'
const activeTab = ref<Tab>('info')

// Availability data lives on the parent because both the Availability tab
// (read/write) and the Price tab (read-only filter "only show available")
// need it. Loaded once on open, refreshed only via the Availability tab's
// own save call.
const availLoading = ref(false)
const allTerritories = ref<{ id: string; currency: string }[]>([])
const selectedTerritories = ref<Set<string>>(new Set())
const availableInNewTerritories = ref(false)

async function loadAvailability(): Promise<void> {
  if (availLoading.value) return
  availLoading.value = true
  try {
    const [availResult, terrResult] = await Promise.all([
      appleApi.getAvailabilityDetail(props.projectId, props.product.id),
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
    notify.error('載入 Availability 失敗')
  }
  availLoading.value = false
}

// Safety net for the rare case where the user clicks into Availability or
// Price before the initial onMounted load finished or was triggered.
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
    @click.self="emit('close')"
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
          @click="emit('close')"
          class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
        >
          &times;
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex shrink-0 border-b border-[#393b40] px-6">
        <button
          v-for="tab in ['info', 'availability', 'price', 'localization'] as Tab[]"
          :key="tab"
          @click="activeTab = tab"
          class="-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
          :class="
            activeTab === tab
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          "
        >
          {{
            tab === 'info'
              ? 'Info'
              : tab === 'availability'
                ? 'Availability'
                : tab === 'price'
                  ? 'Price Schedule'
                  : 'Localization'
          }}
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
            @update-reference-name="(name) => emit('update-reference-name', name)"
          />
          <AppleDetailAvailability
            v-else-if="activeTab === 'availability'"
            :project-id="projectId"
            :iap-id="product.id"
            :loading="availLoading"
            :all-territories="allTerritories"
            v-model:selected-territories="selectedTerritories"
            v-model:available-in-new="availableInNewTerritories"
            @update-availability="(count) => emit('update-availability', count)"
          />
          <AppleDetailPrice
            v-else-if="activeTab === 'price'"
            :project-id="projectId"
            :iap-id="product.id"
            :all-territories="allTerritories"
            :selected-territories="selectedTerritories"
            @update-price="(price, currency) => emit('update-price', price, currency)"
          />
          <AppleDetailLocalization v-else :project-id="projectId" :iap-id="product.id" />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
