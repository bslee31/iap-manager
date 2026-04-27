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
const editingLoc = ref<{ id?: string; locale: string; name: string; description: string } | null>(null)
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
    editingLoc.value = { id: loc.id, locale: loc.locale, name: loc.name, description: loc.description }
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
    const result = await appleApi.updateLocalization(
      props.projectId,
      editingLoc.value.id,
      { name: editingLoc.value.name, description: editingLoc.value.description }
    )
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
    const result = await appleApi.createLocalization(
      props.projectId,
      props.iapId,
      { locale: editingLoc.value.locale, name: editingLoc.value.name, description: editingLoc.value.description }
    )
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
    <div v-if="locLoading" class="text-center py-10 text-gray-500">載入中...</div>
    <template v-else>
      <!-- Add button -->
      <div class="flex justify-between items-center mb-4">
        <span class="text-sm text-gray-400">{{ localizations.length }} 個語言</span>
        <button
          @click="openLocForm()"
          class="px-3 py-1.5 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors"
        >
          + 新增語言
        </button>
      </div>

      <!-- Localization list -->
      <div v-if="localizations.length > 0" class="space-y-2">
        <div
          v-for="loc in localizations"
          :key="loc.id"
          class="bg-[#1e1f22] rounded-lg border border-[#393b40] px-4 py-3 flex items-start justify-between gap-3"
        >
          <div class="flex-1 min-w-0">
            <span class="text-xs px-1.5 py-0.5 rounded bg-[#393b40] text-gray-300">{{ localeLabel(loc.locale) }}</span>
            <div class="text-sm text-gray-200 font-medium mt-1 truncate">{{ loc.name }}</div>
            <p v-if="loc.description" class="text-xs text-gray-400 mt-1 line-clamp-2">{{ loc.description }}</p>
          </div>
          <div class="flex gap-1 shrink-0">
            <button @click="openLocForm(loc)" class="p-1 text-gray-500 hover:text-blue-400 transition-colors" title="編輯">&#9998;</button>
            <button @click="deleteLoc(loc)" class="p-1 text-gray-500 hover:text-red-400 transition-colors" title="刪除">&#10005;</button>
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-gray-500 text-center py-6">尚未新增任何本地化資料</p>

      <!-- Edit/Create form modal -->
      <div v-if="editingLoc" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50" @click.self="editingLoc = null">
        <div class="bg-[#2b2d30] rounded-xl shadow-xl p-6 w-full max-w-md border border-[#393b40] titlebar-no-drag">
          <div class="flex items-center justify-between mb-4">
            <h4 class="text-base font-semibold text-gray-100">
              {{ editingLoc.id ? '編輯本地化' : '新增本地化' }}
            </h4>
            <button @click="editingLoc = null" class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors">&times;</button>
          </div>
          <div class="space-y-3">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Locale</label>
              <select
                v-if="!editingLoc.id"
                v-model="editingLoc.locale"
                class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>請選擇語言...</option>
                <option v-for="l in availableLocales" :key="l.value" :value="l.value">{{ l.label }}</option>
              </select>
              <span v-else class="text-sm text-gray-300 font-mono">{{ editingLoc.locale }}</span>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <label class="text-sm text-gray-400">Name</label>
                <span class="text-xs" :class="(editingLoc?.name.length ?? 0) > 35 ? 'text-red-400' : 'text-gray-500'">{{ editingLoc?.name.length ?? 0 }} / 35</span>
              </div>
              <input
                v-model="editingLoc.name"
                type="text"
                maxlength="35"
                class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                placeholder="商品名稱"
              />
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <label class="text-sm text-gray-400">Description</label>
                <span class="text-xs" :class="(editingLoc?.description.length ?? 0) > 55 ? 'text-red-400' : 'text-gray-500'">{{ editingLoc?.description.length ?? 0 }} / 55</span>
              </div>
              <textarea
                v-model="editingLoc.description"
                rows="3"
                maxlength="55"
                class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                placeholder="商品描述（選填）"
              />
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button @click="editingLoc = null" class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors">取消</button>
            <button
              @click="saveLoc"
              :disabled="locSaving"
              class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {{ locSaving ? '儲存中...' : '儲存' }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
