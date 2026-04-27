<script setup lang="ts">
import { ref, computed } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import { GOOGLE_LANGUAGES, getLanguageLabel } from '../../../utils/google-languages'
import SearchableSelect from '../../common/SearchableSelect.vue'
import * as googleApi from '../../../services/api/google'

interface Listing {
  languageCode: string
  title: string
  description: string
}
interface ProductDetail {
  productId: string
  listings: Listing[]
  purchaseOptions: unknown[]
}

const props = defineProps<{
  projectId: string
  productId: string
  detail: ProductDetail
}>()

const emit = defineEmits<{
  updated: []
}>()

const notify = useNotificationStore()

const editingListing = ref<Listing | null>(null)
const editingIsNew = ref(false)
const listingSaving = ref(false)

const languageOptions = GOOGLE_LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
  right: l.code
}))

const usedLanguageCodes = computed(() => new Set(props.detail.listings.map((l) => l.languageCode)))

const addableLanguageOptions = computed(() => {
  if (!editingListing.value) return languageOptions
  // When editing existing, keep the current code selectable; when adding new, hide already-used.
  if (editingIsNew.value) {
    return languageOptions.filter((o) => !usedLanguageCodes.value.has(o.value))
  }
  return languageOptions
})

function openNewListing() {
  editingListing.value = { languageCode: '', title: '', description: '' }
  editingIsNew.value = true
}

function openEditListing(l: Listing) {
  editingListing.value = { ...l }
  editingIsNew.value = false
}

function cancelEditListing() {
  editingListing.value = null
}

async function saveListing() {
  if (!editingListing.value) return
  const e = editingListing.value
  if (!e.languageCode) {
    notify.error('請選擇語言')
    return
  }
  if (!e.title.trim()) {
    notify.error('請填寫名稱')
    return
  }
  // Build a plain array (not reactive proxies) so Electron IPC can clone it.
  const next: Listing[] = props.detail.listings.map((l) => ({
    languageCode: l.languageCode,
    title: l.title,
    description: l.description
  }))
  if (editingIsNew.value) {
    if (next.some((l) => l.languageCode === e.languageCode)) {
      notify.error('此語言已存在')
      return
    }
    next.push({
      languageCode: e.languageCode,
      title: e.title.trim(),
      description: e.description.trim()
    })
  } else {
    const idx = next.findIndex((l) => l.languageCode === e.languageCode)
    if (idx < 0) {
      notify.error('找不到要更新的 listing')
      return
    }
    next[idx] = {
      languageCode: e.languageCode,
      title: e.title.trim(),
      description: e.description.trim()
    }
  }
  listingSaving.value = true
  const result = await googleApi.updateListings(props.projectId, props.productId, next)
  listingSaving.value = false
  if (result.success && result.data) {
    editingListing.value = null
    notify.success('Listings 已更新')
    emit('updated')
  } else {
    notify.error(result.error || '儲存失敗')
  }
}

async function deleteListing(languageCode: string) {
  if (props.detail.listings.length <= 1) {
    notify.error('至少需保留一個 listing')
    return
  }
  if (!confirm(`確定刪除 ${getLanguageLabel(languageCode)} 的 listing 嗎？`)) return
  const next: Listing[] = props.detail.listings
    .filter((l) => l.languageCode !== languageCode)
    .map((l) => ({
      languageCode: l.languageCode,
      title: l.title,
      description: l.description
    }))
  const result = await googleApi.updateListings(props.projectId, props.productId, next)
  if (result.success && result.data) {
    notify.success('已刪除')
    emit('updated')
  } else {
    notify.error(result.error || '刪除失敗')
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex shrink-0 items-center justify-between px-6 pt-4 pb-3">
      <span class="text-sm text-gray-400">共 {{ detail.listings.length }} 個語言</span>
      <button
        class="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-700"
        @click="openNewListing"
      >
        + 新增語言
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
      <div v-if="detail.listings.length === 0" class="py-10 text-center text-gray-500">
        尚無 listings
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="l in detail.listings"
          :key="l.languageCode"
          class="flex items-start justify-between gap-3 rounded-lg border border-[#43454a] bg-[#1e1f22] px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <div>
              <span class="rounded bg-[#393b40] px-1.5 py-0.5 text-xs text-gray-300">{{
                getLanguageLabel(l.languageCode)
              }}</span>
              <span class="ml-2 font-mono text-xs text-gray-500">{{ l.languageCode }}</span>
            </div>
            <div class="mt-1 truncate text-sm font-medium text-gray-200">{{ l.title }}</div>
            <p v-if="l.description" class="mt-1 line-clamp-2 text-xs text-gray-400">
              {{ l.description }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <button
              class="p-1 text-gray-500 transition-colors hover:text-blue-400"
              title="編輯"
              @click="openEditListing(l)"
            >
              &#9998;
            </button>
            <button
              class="p-1 text-gray-500 transition-colors hover:text-red-400"
              title="刪除"
              @click="deleteListing(l.languageCode)"
            >
              &#10005;
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Listing Edit Dialog -->
    <div
      v-if="editingListing"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="cancelEditListing"
    >
      <div
        class="titlebar-no-drag flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-[#393b40] bg-[#2b2d30] shadow-xl"
      >
        <div class="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h3 class="text-lg font-semibold text-gray-100">
            {{ editingIsNew ? '新增 Listing' : '編輯 Listing' }}
          </h3>
          <button
            class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
            @click="cancelEditListing"
          >
            &times;
          </button>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">語言</label>
            <SearchableSelect
              v-if="editingIsNew"
              v-model="editingListing.languageCode"
              :options="addableLanguageOptions"
              placeholder="選擇語言"
            />
            <div
              v-else
              class="rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-400"
            >
              {{ getLanguageLabel(editingListing.languageCode) }}
              <span class="ml-2 font-mono text-xs text-gray-500">{{
                editingListing.languageCode
              }}</span>
            </div>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">名稱 (title)</label>
            <input
              v-model="editingListing.title"
              type="text"
              maxlength="55"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
            />
            <p class="mt-1 text-right text-xs text-gray-500">
              {{ editingListing.title.length }} / 55
            </p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">描述 (description)</label>
            <textarea
              v-model="editingListing.description"
              rows="4"
              maxlength="200"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
            />
            <p class="mt-1 text-right text-xs text-gray-500">
              {{ editingListing.description.length }} / 200
            </p>
          </div>
        </div>
        <div class="flex shrink-0 justify-end gap-2 border-t border-[#393b40] px-6 py-4">
          <button
            class="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-[#393b40]"
            @click="cancelEditListing"
          >
            取消
          </button>
          <button
            :disabled="listingSaving"
            class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            @click="saveListing"
          >
            {{ listingSaving ? '儲存中...' : '儲存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
