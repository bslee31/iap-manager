<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../../stores/notification.store'
import { useAppleProductsStore } from '../../../stores/apple-products.store'
import TerritoryPicker from './TerritoryPicker.vue'
import * as appleApi from '../../../services/api/apple'

const props = defineProps<{
  projectId: string
  iapId: string
  loading: boolean
  allTerritories: { id: string; currency: string }[]
}>()

const selectedTerritories = defineModel<Set<string>>('selectedTerritories', { required: true })
const availableInNewTerritories = defineModel<boolean>('availableInNew', { required: true })

const { t } = useI18n()
const notify = useNotificationStore()
const store = useAppleProductsStore()

const availSaving = ref(false)

async function saveAvailability() {
  availSaving.value = true
  const result = await appleApi.updateAvailability(
    props.projectId,
    props.iapId,
    Array.from(selectedTerritories.value),
    availableInNewTerritories.value
  )
  availSaving.value = false
  if (result.success) {
    notify.success(t('apple.detail.availability.toast.updateSuccess'))
    store.updateProductTerritoryCount(selectedTerritories.value.size)
  } else {
    notify.error(result.error || t('apple.detail.availability.toast.updateFail'))
  }
}
</script>

<template>
  <TerritoryPicker
    v-model:selected-territories="selectedTerritories"
    v-model:available-in-new="availableInNewTerritories"
    :loading="loading"
    :all-territories="allTerritories"
  >
    <template #actions>
      <div class="flex justify-end">
        <button
          :disabled="availSaving"
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          @click="saveAvailability"
        >
          {{ availSaving ? t('common.saving') : t('apple.detail.availability.saveButton') }}
        </button>
      </div>
    </template>
  </TerritoryPicker>
</template>
