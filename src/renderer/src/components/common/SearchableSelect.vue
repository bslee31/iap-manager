<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps<{
  modelValue: string
  options: { value: string; label: string; right?: string }[]
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const search = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)

const selectedLabel = computed(() => {
  const opt = props.options.find((o) => o.value === props.modelValue)
  return opt?.label || ''
})

const filtered = computed(() => {
  if (!search.value.trim()) return props.options
  const q = search.value.trim().toLowerCase()
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})

function toggle() {
  open.value = !open.value
  if (open.value) {
    search.value = ''
    nextTick(() => inputRef.value?.focus())
  }
}

function select(value: string) {
  emit('update:modelValue', value)
  open.value = false
  search.value = ''
}

function onBlur() {
  // Delay to allow click on option to fire first
  setTimeout(() => {
    open.value = false
    search.value = ''
  }, 150)
}
</script>

<template>
  <div class="relative">
    <!-- Display / trigger -->
    <button
      type="button"
      @click="toggle"
      class="flex w-full items-center justify-between rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-1.5 text-left text-sm transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
      :class="selectedLabel ? 'text-gray-200' : 'text-gray-500'"
    >
      <span class="truncate">{{ selectedLabel || placeholder || '請選擇...' }}</span>
      <span class="ml-2 shrink-0 text-[10px] text-gray-500">&#9660;</span>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      ref="listRef"
      class="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-[#43454a] bg-[#2b2d30] shadow-xl"
    >
      <!-- Search input -->
      <div class="border-b border-[#393b40] p-2">
        <input
          ref="inputRef"
          v-model="search"
          type="text"
          class="w-full rounded border border-[#43454a] bg-[#1e1f22] px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          placeholder="搜尋..."
          @blur="onBlur"
        />
      </div>
      <!-- Options list -->
      <div class="max-h-[200px] overflow-y-auto">
        <button
          v-for="opt in filtered"
          :key="opt.value"
          type="button"
          @mousedown.prevent="select(opt.value)"
          class="flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors"
          :class="
            opt.value === modelValue
              ? 'bg-blue-600/20 text-blue-400'
              : 'text-gray-300 hover:bg-[#393b40]'
          "
        >
          <span>{{ opt.label }}</span>
          <span v-if="opt.right" class="ml-3 shrink-0 text-xs text-gray-500">{{ opt.right }}</span>
        </button>
        <p v-if="filtered.length === 0" class="px-3 py-2 text-center text-xs text-gray-500">
          找不到結果
        </p>
      </div>
    </div>
  </div>
</template>
