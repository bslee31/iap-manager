<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'

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
  const result = await window.api.updateAppleProduct(props.projectId, props.iapId, {
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
        <label class="block text-xs font-medium text-gray-500 uppercase mb-1">Product ID</label>
        <div class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-400 font-mono">
          {{ productId }}
        </div>
        <p class="text-xs text-gray-500 mt-1">Product ID 建立後無法修改</p>
      </div>

      <!-- Type (read-only) -->
      <div>
        <label class="block text-xs font-medium text-gray-500 uppercase mb-1">Type</label>
        <div class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-400">
          {{ type }}
        </div>
      </div>

      <!-- State (read-only) -->
      <div>
        <label class="block text-xs font-medium text-gray-500 uppercase mb-1">State</label>
        <div class="px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-400 font-mono">
          {{ state }}
        </div>
      </div>

      <!-- Reference Name (editable) -->
      <div>
        <label class="block text-xs font-medium text-gray-500 uppercase mb-1">Reference Name</label>
        <input
          v-model="editingReferenceName"
          type="text"
          :disabled="!canEditReferenceName || savingReferenceName"
          :maxlength="MAX_REF_NAME"
          class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder="Reference Name"
        />
        <div class="flex items-center justify-between mt-1">
          <p v-if="!canEditReferenceName" class="text-xs text-yellow-500">
            此狀態（{{ state }}）下 Apple 不允許修改
          </p>
          <p v-else class="text-xs text-gray-500">App Store Connect 內部顯示名稱，不影響使用者看到的內容</p>
          <p class="text-xs text-gray-500 shrink-0 ml-2">{{ editingReferenceName.length }} / {{ MAX_REF_NAME }}</p>
        </div>
      </div>

      <div class="flex justify-end pt-2">
        <button
          @click="saveReferenceName"
          :disabled="!canEditReferenceName || savingReferenceName || !referenceNameChanged || !referenceNameValid"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {{ savingReferenceName ? '儲存中...' : '儲存變更' }}
        </button>
      </div>
    </div>
  </div>
</template>
