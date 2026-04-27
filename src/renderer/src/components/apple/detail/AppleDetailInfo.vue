<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import * as appleApi from '../../../services/api/apple'

const props = defineProps<{
  projectId: string
  iapId: string
  productId: string
  type: string
  state: string
  referenceName: string
}>()

const emit = defineEmits<{
  'update-reference-name': [referenceName: string]
}>()

const notify = useNotificationStore()

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
    notify.success('Reference Name 已更新')
    emit('update-reference-name', result.data.referenceName)
  } else {
    notify.error(result.error || '更新失敗')
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
          class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 font-mono text-sm text-gray-400"
        >
          {{ productId }}
        </div>
        <p class="mt-1 text-xs text-gray-500">Product ID 建立後無法修改</p>
      </div>

      <!-- Type (read-only) -->
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">Type</label>
        <div
          class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-400"
        >
          {{ type }}
        </div>
      </div>

      <!-- State (read-only) -->
      <div>
        <label class="mb-1 block text-xs font-medium text-gray-500 uppercase">State</label>
        <div
          class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 font-mono text-sm text-gray-400"
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
          class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Reference Name"
        />
        <div class="mt-1 flex items-center justify-between">
          <p v-if="!canEditReferenceName" class="text-xs text-yellow-500">
            此狀態（{{ state }}）下 Apple 不允許修改
          </p>
          <p v-else class="text-xs text-gray-500">
            App Store Connect 內部顯示名稱，不影響使用者看到的內容
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
          {{ savingReferenceName ? '儲存中...' : '儲存變更' }}
        </button>
      </div>
    </div>
  </div>
</template>
