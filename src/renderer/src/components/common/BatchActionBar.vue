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
    class="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-[#43454a] bg-[#393b40] px-6 py-3 text-white shadow-2xl"
  >
    <span class="text-sm whitespace-nowrap">已選 {{ count }} 項</span>
    <div class="h-5 w-px bg-[#43454a]" />
    <button
      v-for="action in actions"
      :key="action.key"
      @click="$emit('action', action.key)"
      class="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors"
      :class="
        action.variant === 'danger'
          ? 'bg-red-600 hover:bg-red-700'
          : 'bg-blue-600 hover:bg-blue-700'
      "
    >
      {{ action.label }}
    </button>
    <button
      @click="$emit('clear')"
      class="ml-2 text-sm whitespace-nowrap text-gray-400 transition-colors hover:text-white"
    >
      取消選取
    </button>
  </div>
</template>
