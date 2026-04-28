<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../../stores/notification.store'
import { useAppleProductsStore } from '../../../stores/apple-products.store'
import * as appleApi from '../../../services/api/apple'

const props = defineProps<{
  projectId: string
  iapId: string
  productId: string
  type: string
  state: string
  referenceName: string
}>()

const { t } = useI18n()
const notify = useNotificationStore()
const store = useAppleProductsStore()

const MAX_REF_NAME = 64
// States where Apple blocks edits (conservative list; API error also surfaced)
const NON_EDITABLE_STATES = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PROCESSING_CONTENT'])

const editingReferenceName = ref(props.referenceName)
const savingReferenceName = ref(false)

const canEditReferenceName = computed(() => !NON_EDITABLE_STATES.has(props.state))
const referenceNameChanged = computed(
  () => editingReferenceName.value.trim() !== props.referenceName.trim()
)
const referenceNameValid = computed(() => {
  const v = editingReferenceName.value.trim()
  return v.length > 0 && v.length <= MAX_REF_NAME
})

watch(
  () => props.referenceName,
  (name) => {
    editingReferenceName.value = name
  }
)

async function saveReferenceName(): Promise<void> {
  const newName = editingReferenceName.value.trim()
  if (!newName || newName.length > MAX_REF_NAME) return
  savingReferenceName.value = true
  const result = await appleApi.updateProduct(props.projectId, props.iapId, {
    referenceName: newName
  })
  savingReferenceName.value = false
  if (result.success) {
    notify.success(t('apple.detail.info.toast.updateSuccess'))
    store.updateProductReferenceName(result.data.referenceName)
  } else {
    notify.error(result.error || t('apple.detail.info.toast.updateFail'))
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div class="space-y-5">
      <!-- Product ID (read-only) -->
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Product ID</label>
        <div
          class="border-divider-strong bg-deep rounded-lg border px-3 py-2 font-mono text-sm text-gray-400"
        >
          {{ productId }}
        </div>
        <p class="mt-1 text-xs text-gray-500">{{ t('apple.detail.info.idLockedHint') }}</p>
      </div>

      <!-- Type (read-only) -->
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Type</label>
        <div
          class="border-divider-strong bg-deep rounded-lg border px-3 py-2 text-sm text-gray-400"
        >
          {{ type }}
        </div>
      </div>

      <!-- State (read-only) -->
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">State</label>
        <div
          class="border-divider-strong bg-deep rounded-lg border px-3 py-2 font-mono text-sm text-gray-400"
        >
          {{ state }}
        </div>
      </div>

      <!-- Reference Name (editable) -->
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Reference Name</label>
        <input
          v-model="editingReferenceName"
          type="text"
          :disabled="!canEditReferenceName || savingReferenceName"
          :maxlength="MAX_REF_NAME"
          class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Reference Name"
        />
        <div class="mt-1 flex items-center justify-between">
          <p v-if="!canEditReferenceName" class="text-xs text-yellow-500">
            {{ t('apple.detail.info.notEditable', { state }) }}
          </p>
          <p v-else class="text-xs text-gray-500">
            {{ t('apple.detail.info.refNameHint') }}
          </p>
          <p class="ml-2 shrink-0 text-xs text-gray-500">
            {{ editingReferenceName.length }} / {{ MAX_REF_NAME }}
          </p>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <button
          :disabled="
            !canEditReferenceName ||
            savingReferenceName ||
            !referenceNameChanged ||
            !referenceNameValid
          "
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="saveReferenceName"
        >
          {{ savingReferenceName ? t('common.saving') : t('common.saveChanges') }}
        </button>
      </div>
    </div>
  </div>
</template>
