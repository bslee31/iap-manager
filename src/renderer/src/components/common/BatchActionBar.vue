<script setup lang="ts">
defineProps<{
  count: number
  actions: { key: string; label: string; variant?: 'danger' | 'default' }[]
}>()

defineEmits<{
  action: [key: string]
  clear: []
}>()
</script>

<template>
  <div
    v-if="count > 0"
    class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#393b40] text-white rounded-xl shadow-2xl px-6 py-3 flex items-center gap-4 z-30 border border-[#43454a]"
  >
    <span class="text-sm">已選 {{ count }} 項</span>
    <div class="w-px h-5 bg-[#43454a]" />
    <button
      v-for="action in actions"
      :key="action.key"
      @click="$emit('action', action.key)"
      class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
      :class="action.variant === 'danger'
        ? 'bg-red-600 hover:bg-red-700'
        : 'bg-blue-600 hover:bg-blue-700'"
    >
      {{ action.label }}
    </button>
    <button
      @click="$emit('clear')"
      class="text-gray-400 hover:text-white text-sm transition-colors ml-2"
    >
      取消選取
    </button>
  </div>
</template>
