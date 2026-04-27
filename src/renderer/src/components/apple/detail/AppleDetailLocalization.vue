<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import * as appleApi from '../../../services/api/apple'

const props = defineProps<{
  projectId: string
  iapId: string
}>()

const notify = useNotificationStore()

interface Localization {
  id: string
  locale: string
  name: string
  description: string
}

const locLoading = ref(false)
const localizations = ref<Localization[]>([])
const editingLoc = ref<{ id?: string; locale: string; name: string; description: string } | null>(
  null
)
const locSaving = ref(false)
const primaryLocale = ref('en-US')

async function loadLocalizations() {
  locLoading.value = true
  const [locResult, localeResult] = await Promise.all([
    appleApi.getLocalizations(props.projectId, props.iapId),
    primaryLocale.value === 'en-US' ? appleApi.getPrimaryLocale(props.projectId) : null
  ])
  if (locResult.success) {
    localizations.value = locResult.data
  }
  if (localeResult?.success) {
    primaryLocale.value = localeResult.data
  }
  locLoading.value = false
}

const availableLocales = computed(() => {
  const existing = new Set(localizations.value.map((l) => l.locale))
  return LOCALES.filter((l) => !existing.has(l.value))
})

function openLocForm(loc?: Localization) {
  if (loc) {
    editingLoc.value = {
      id: loc.id,
      locale: loc.locale,
      name: loc.name,
      description: loc.description
    }
  } else {
    const existing = new Set(localizations.value.map((l) => l.locale))
    const defaultLocale = existing.has(primaryLocale.value) ? '' : primaryLocale.value
    editingLoc.value = { locale: defaultLocale, name: '', description: '' }
  }
}

async function saveLoc() {
  if (!editingLoc.value) return
  locSaving.value = true

  if (editingLoc.value.id) {
    const result = await appleApi.updateLocalization(props.projectId, editingLoc.value.id, {
      name: editingLoc.value.name,
      description: editingLoc.value.description
    })
    if (result.success) {
      notify.success('已更新')
      await loadLocalizations()
    } else {
      notify.error(result.error || '更新失敗')
    }
  } else {
    if (!editingLoc.value.locale || !editingLoc.value.name) {
      notify.error('請填寫 Locale 和 Name')
      locSaving.value = false
      return
    }
    const result = await appleApi.createLocalization(props.projectId, props.iapId, {
      locale: editingLoc.value.locale,
      name: editingLoc.value.name,
      description: editingLoc.value.description
    })
    if (result.success) {
      notify.success('已新增')
      await loadLocalizations()
    } else {
      notify.error(result.error || '新增失敗')
    }
  }

  editingLoc.value = null
  locSaving.value = false
}

async function deleteLoc(loc: Localization) {
  if (!confirm(`確定要刪除 ${loc.locale} 的本地化資料嗎？`)) return
  const result = await appleApi.deleteLocalization(props.projectId, loc.id)
  if (result.success) {
    notify.success('已刪除')
    await loadLocalizations()
  } else {
    notify.error(result.error || '刪除失敗')
  }
}

function localeLabel(code: string): string {
  return LOCALES.find((l) => l.value === code)?.label || code
}

const LOCALES = [
  { value: 'ar-SA', label: 'Arabic' },
  { value: 'bn-BD', label: 'Bangla' },
  { value: 'ca', label: 'Catalan' },
  { value: 'zh-Hans', label: 'Chinese (Simplified)' },
  { value: 'zh-Hant', label: 'Chinese (Traditional)' },
  { value: 'hr', label: 'Croatian' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-GB', label: 'English (U.K.)' },
  { value: 'en-US', label: 'English (U.S.)' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'fr-CA', label: 'French (Canada)' },
  { value: 'de-DE', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'gu-IN', label: 'Gujarati' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'kn-IN', label: 'Kannada' },
  { value: 'ko', label: 'Korean' },
  { value: 'ms', label: 'Malay' },
  { value: 'ml-IN', label: 'Malayalam' },
  { value: 'mr-IN', label: 'Marathi' },
  { value: 'no', label: 'Norwegian' },
  { value: 'or-IN', label: 'Odia' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'pt-PT', label: 'Portuguese (Portugal)' },
  { value: 'pa-IN', label: 'Punjabi' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl-SI', label: 'Slovenian' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'sv', label: 'Swedish' },
  { value: 'ta-IN', label: 'Tamil' },
  { value: 'te-IN', label: 'Telugu' },
  { value: 'th', label: 'Thai' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ur-PK', label: 'Urdu' },
  { value: 'vi', label: 'Vietnamese' }
]

onMounted(() => {
  loadLocalizations()
})
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <div v-if="locLoading" class="py-10 text-center text-gray-500">載入中...</div>
    <template v-else>
      <!-- Add button -->
      <div class="mb-4 flex items-center justify-between">
        <span class="text-sm text-gray-400">{{ localizations.length }} 個語言</span>
        <button
          @click="openLocForm()"
          class="rounded-lg border border-[#43454a] px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-[#393b40]"
        >
          + 新增語言
        </button>
      </div>

      <!-- Localization list -->
      <div v-if="localizations.length > 0" class="space-y-2">
        <div
          v-for="loc in localizations"
          :key="loc.id"
          class="flex items-start justify-between gap-3 rounded-lg border border-[#393b40] bg-[#1e1f22] px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <span class="rounded bg-[#393b40] px-1.5 py-0.5 text-xs text-gray-300">{{
              localeLabel(loc.locale)
            }}</span>
            <div class="mt-1 truncate text-sm font-medium text-gray-200">{{ loc.name }}</div>
            <p v-if="loc.description" class="mt-1 line-clamp-2 text-xs text-gray-400">
              {{ loc.description }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <button
              @click="openLocForm(loc)"
              class="p-1 text-gray-500 transition-colors hover:text-blue-400"
              title="編輯"
            >
              &#9998;
            </button>
            <button
              @click="deleteLoc(loc)"
              class="p-1 text-gray-500 transition-colors hover:text-red-400"
              title="刪除"
            >
              &#10005;
            </button>
          </div>
        </div>
      </div>
      <p v-else class="py-6 text-center text-sm text-gray-500">尚未新增任何本地化資料</p>

      <!-- Edit/Create form modal -->
      <div
        v-if="editingLoc"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="editingLoc = null"
      >
        <div
          class="titlebar-no-drag w-full max-w-md rounded-xl border border-[#393b40] bg-[#2b2d30] p-6 shadow-xl"
        >
          <div class="mb-4 flex items-center justify-between">
            <h4 class="text-base font-semibold text-gray-100">
              {{ editingLoc.id ? '編輯本地化' : '新增本地化' }}
            </h4>
            <button
              @click="editingLoc = null"
              class="rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:bg-[#393b40] hover:text-gray-300"
            >
              &times;
            </button>
          </div>
          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-sm text-gray-400">Locale</label>
              <select
                v-if="!editingLoc.id"
                v-model="editingLoc.locale"
                class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="" disabled>請選擇語言...</option>
                <option v-for="l in availableLocales" :key="l.value" :value="l.value">
                  {{ l.label }}
                </option>
              </select>
              <span v-else class="font-mono text-sm text-gray-300">{{ editingLoc.locale }}</span>
            </div>
            <div>
              <div class="mb-1 flex justify-between">
                <label class="text-sm text-gray-400">Name</label>
                <span
                  class="text-xs"
                  :class="(editingLoc?.name.length ?? 0) > 35 ? 'text-red-400' : 'text-gray-500'"
                  >{{ editingLoc?.name.length ?? 0 }} / 35</span
                >
              </div>
              <input
                v-model="editingLoc.name"
                type="text"
                maxlength="35"
                class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="商品名稱"
              />
            </div>
            <div>
              <div class="mb-1 flex justify-between">
                <label class="text-sm text-gray-400">Description</label>
                <span
                  class="text-xs"
                  :class="
                    (editingLoc?.description.length ?? 0) > 55 ? 'text-red-400' : 'text-gray-500'
                  "
                  >{{ editingLoc?.description.length ?? 0 }} / 55</span
                >
              </div>
              <textarea
                v-model="editingLoc.description"
                rows="3"
                maxlength="55"
                class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="商品描述（選填）"
              />
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button
              @click="editingLoc = null"
              class="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-[#393b40]"
            >
              取消
            </button>
            <button
              @click="saveLoc"
              :disabled="locSaving"
              class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {{ locSaving ? '儲存中...' : '儲存' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
