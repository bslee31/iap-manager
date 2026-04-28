<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: string
  options: { value: string; label: string; right?: string }[]
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()

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
      class="border-divider-strong bg-deep flex w-full items-center justify-between rounded-lg border px-3 py-1.5 text-left text-sm transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
      :class="selectedLabel ? 'text-gray-200' : 'text-gray-500'"
      @click="toggle"
    >
      <span class="truncate">{{
        selectedLabel || placeholder || t('common.selectPlaceholder')
      }}</span>
      <span class="ml-2 shrink-0 text-[10px] text-gray-500">&#9660;</span>
    </button>

    <!-- Dropdown -->
    <div
      v-if="open"
      ref="listRef"
      class="border-divider-strong bg-card absolute z-50 mt-1 w-full overflow-hidden rounded-lg border shadow-xl"
    >
      <!-- Search input -->
      <div class="border-divider border-b p-2">
        <input
          ref="inputRef"
          v-model="search"
          type="text"
          class="border-divider-strong bg-deep w-full rounded border px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          :placeholder="t('common.searchPlaceholder')"
          @blur="onBlur"
        />
      </div>
      <!-- Options list -->
      <div class="max-h-[200px] overflow-y-auto">
        <button
          v-for="opt in filtered"
          :key="opt.value"
          type="button"
          class="flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors"
          :class="
            opt.value === modelValue
              ? 'bg-blue-600/20 text-blue-400'
              : 'hover:bg-divider text-gray-300'
          "
          @mousedown.prevent="select(opt.value)"
        >
          <span>{{ opt.label }}</span>
          <span v-if="opt.right" class="ml-3 shrink-0 text-xs text-gray-500">{{ opt.right }}</span>
        </button>
        <p v-if="filtered.length === 0" class="px-3 py-2 text-center text-xs text-gray-500">
          {{ t('common.noMatch') }}
        </p>
      </div>
    </div>
  </div>
</template>
