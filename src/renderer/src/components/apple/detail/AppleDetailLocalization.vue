<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../../stores/notification.store'
import * as appleApi from '../../../services/api/apple'

const props = defineProps<{
  projectId: string
  iapId: string
}>()

const { t } = useI18n()
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
      notify.success(t('apple.detail.localization.toast.updateSuccess'))
      await loadLocalizations()
    } else {
      notify.error(result.error || t('apple.detail.localization.toast.updateFail'))
    }
  } else {
    if (!editingLoc.value.locale || !editingLoc.value.name) {
      notify.error(t('apple.detail.localization.toast.fillRequired'))
      locSaving.value = false
      return
    }
    const result = await appleApi.createLocalization(props.projectId, props.iapId, {
      locale: editingLoc.value.locale,
      name: editingLoc.value.name,
      description: editingLoc.value.description
    })
    if (result.success) {
      notify.success(t('apple.detail.localization.toast.createSuccess'))
      await loadLocalizations()
    } else {
      notify.error(result.error || t('apple.detail.localization.toast.createFail'))
    }
  }

  editingLoc.value = null
  locSaving.value = false
}

async function deleteLoc(loc: Localization) {
  if (!confirm(t('apple.detail.localization.deleteConfirm', { locale: loc.locale }))) return
  const result = await appleApi.deleteLocalization(props.projectId, loc.id)
  if (result.success) {
    notify.success(t('apple.detail.localization.toast.deleteSuccess'))
    await loadLocalizations()
  } else {
    notify.error(result.error || t('apple.detail.localization.toast.deleteFail'))
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
    <div v-if="locLoading" class="py-10 text-center text-gray-500">{{ t('common.loading') }}</div>
    <template v-else>
      <!-- Add button -->
      <div class="mb-4 flex items-center justify-between">
        <span class="text-sm text-gray-400">{{
          t('apple.detail.localization.langCount', { count: localizations.length })
        }}</span>
        <button
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700"
          @click="openLocForm()"
        >
          {{ t('apple.detail.localization.addLang') }}
        </button>
      </div>

      <!-- Localization list -->
      <div v-if="localizations.length > 0" class="space-y-2">
        <div
          v-for="loc in localizations"
          :key="loc.id"
          class="border-divider bg-deep flex items-start justify-between gap-3 rounded-lg border px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <span class="bg-divider rounded px-1.5 py-0.5 text-xs text-gray-300">{{
              localeLabel(loc.locale)
            }}</span>
            <div class="mt-1 truncate text-sm font-medium text-gray-200">{{ loc.name }}</div>
            <p v-if="loc.description" class="mt-1 line-clamp-2 text-xs text-gray-400">
              {{ loc.description }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <button
              class="p-1 text-gray-500 transition-colors hover:text-blue-400"
              :title="t('common.edit')"
              @click="openLocForm(loc)"
            >
              &#9998;
            </button>
            <button
              class="p-1 text-gray-500 transition-colors hover:text-red-400"
              :title="t('common.delete')"
              @click="deleteLoc(loc)"
            >
              &#10005;
            </button>
          </div>
        </div>
      </div>
      <p v-else class="py-6 text-center text-sm text-gray-500">
        {{ t('apple.detail.localization.empty') }}
      </p>

      <!-- Edit/Create form modal -->
      <div
        v-if="editingLoc"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="editingLoc = null"
      >
        <div
          class="titlebar-no-drag border-divider bg-card w-full max-w-md rounded-xl border p-6 shadow-xl"
        >
          <div class="mb-4 flex items-center justify-between">
            <h4 class="text-base font-semibold text-gray-100">
              {{
                editingLoc.id
                  ? t('apple.detail.localization.editTitle')
                  : t('apple.detail.localization.createTitle')
              }}
            </h4>
            <button
              class="hover:bg-divider rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:text-gray-300"
              @click="editingLoc = null"
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
                class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="" disabled>
                  {{ t('apple.detail.localization.localePlaceholder') }}
                </option>
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
                class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                :placeholder="t('apple.detail.localization.namePlaceholder')"
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
                class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                :placeholder="t('apple.detail.localization.descPlaceholder')"
              />
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button
              class="hover:bg-divider rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors"
              @click="editingLoc = null"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              :disabled="locSaving"
              class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              @click="saveLoc"
            >
              {{ locSaving ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
