<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../stores/notification.store'
import TerritoryPicker from './detail/TerritoryPicker.vue'
import * as appleApi from '../../services/api/apple'
import type { AppleProduct } from '../../stores/apple-products.store'

const props = defineProps<{
  projectId: string
  products: AppleProduct[]
}>()

const emit = defineEmits<{ close: []; done: [] }>()

const { t } = useI18n()
const notify = useNotificationStore()

const loading = ref(true)
const applying = ref(false)
const allTerritories = ref<{ id: string; currency: string }[]>([])
const selectedTerritories = ref<Set<string>>(new Set())
const availableInNewTerritories = ref(false)

onMounted(async () => {
  const result = await appleApi.getAllTerritories(props.projectId)
  if (result.success) {
    allTerritories.value = result.data
  } else {
    notify.error(result.error || t('apple.batch.setAvailability.territoriesFail'))
    emit('close')
    return
  }
  loading.value = false
})

// Built from the territory counts already cached with the product list, so the
// blast radius is visible before applying without spending a single API call.
const currentCounts = computed(() => {
  const counts = new Set(props.products.map((p) => p.territoryCount))
  return [...counts].sort((a, b) => b - a)
})

const countsDiffer = computed(() => currentCounts.value.length > 1)

// Closing mid-apply would drop the result toast and skip the parent's cache
// reload, leaving the list showing counts that are already wrong.
function requestClose() {
  if (applying.value) return
  emit('close')
}

async function apply() {
  const count = props.products.length
  const territories = selectedTerritories.value.size
  if (!confirm(t('apple.batch.setAvailability.confirm', { count, territories }))) return

  applying.value = true
  const result = await appleApi.batchSetAvailability(
    props.projectId,
    props.products.map((p) => p.id),
    Array.from(selectedTerritories.value),
    availableInNewTerritories.value
  )
  applying.value = false

  if (!result.success) {
    notify.error(result.error || t('apple.batch.opFailed'))
    return
  }

  const { data } = result
  if (data.failed.length > 0) {
    const details = data.failed
      .map((f: { id: string; error: string }) => {
        const product = props.products.find((p) => p.id === f.id)
        return `${product?.productId || f.id}: ${f.error}`
      })
      .join('\n')
    notify.error(t('apple.batch.failedItems', { count: data.failed.length, details }))
  }
  if (data.success.length > 0) {
    notify.success(t('apple.batch.setAvailability.success', { count: data.success.length }))
  }

  emit('done')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    @click.self="requestClose"
  >
    <div
      class="titlebar-no-drag border-divider bg-card flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border shadow-xl"
    >
      <div class="border-divider flex shrink-0 items-center justify-between border-b p-6">
        <h3 class="text-lg font-semibold text-gray-100">
          {{ t('apple.batch.setAvailability.title') }}
        </h3>
        <button
          :disabled="applying"
          class="text-gray-500 hover:text-gray-300 disabled:opacity-40"
          @click="requestClose"
        >
          &times;
        </button>
      </div>

      <!-- Impact summary: what the selected products look like now, and what
           they will all become. -->
      <div class="border-divider shrink-0 border-b px-6 py-3">
        <p class="text-sm text-gray-300">
          {{
            t('apple.batch.setAvailability.summary', {
              count: products.length,
              territories: selectedTerritories.size
            })
          }}
        </p>
        <p v-if="countsDiffer" class="mt-1 text-xs text-amber-400">
          {{ t('apple.batch.setAvailability.mixedWarning', { counts: currentCounts.join(' / ') }) }}
        </p>
        <p v-if="selectedTerritories.size === 0" class="mt-1 text-xs text-amber-400">
          {{ t('apple.batch.setAvailability.emptyWarning') }}
        </p>
      </div>

      <TerritoryPicker
        v-model:selected-territories="selectedTerritories"
        v-model:available-in-new="availableInNewTerritories"
        :loading="loading"
        :all-territories="allTerritories"
      >
        <template #actions>
          <div class="flex justify-end gap-2">
            <button
              :disabled="applying"
              class="hover:bg-divider rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors disabled:opacity-40"
              @click="requestClose"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              :disabled="applying"
              class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              @click="apply"
            >
              {{
                applying
                  ? t('apple.batch.setAvailability.applying')
                  : t('apple.batch.setAvailability.apply')
              }}
            </button>
          </div>
        </template>
      </TerritoryPicker>
    </div>
  </div>
</template>
