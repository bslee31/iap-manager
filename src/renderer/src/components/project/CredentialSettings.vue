<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../stores/notification.store'
import SearchableSelect from '../common/SearchableSelect.vue'
import { GOOGLE_LANGUAGES } from '../../utils/google-languages'
import * as credentialApi from '../../services/api/credential'
import * as googleApi from '../../services/api/google'
import * as dialogApi from '../../services/api/dialog'

const props = defineProps<{ projectId: string }>()
const { t } = useI18n()
const notify = useNotificationStore()

// Apple
const appleKeyId = ref('')
const appleIssuerId = ref('')
const appleAppId = ref('')
const appleHasKey = ref(false)
const appleP8Content = ref('')
const appleTesting = ref(false)

// Google
const googlePackageName = ref('')
const googleHasAccount = ref(false)
const googleSavedAccount = ref(false) // true iff credentials are persisted to disk
const googleJsonContent = ref('')
const googleTesting = ref(false)
const googleDefaultLanguage = ref('')
const googleDetectingLanguage = ref(false)
const googleBaseRegion = ref('')
const googleRegions = ref<{ regionCode: string; currencyCode: string }[]>([])
const googleRegionsLoading = ref(false)

const languageOptions = computed(() =>
  GOOGLE_LANGUAGES.map((l) => ({
    value: l.code,
    label: l.label,
    right: l.code
  }))
)

const regionDisplay = new Intl.DisplayNames(['en'], { type: 'region' })
const regionOptions = computed(() =>
  googleRegions.value
    .map((r) => ({
      value: r.regionCode,
      label: regionDisplay.of(r.regionCode) || r.regionCode,
      right: `${r.regionCode} · ${r.currencyCode}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
)

onMounted(async () => {
  const result = await credentialApi.get(props.projectId)
  if (result.success && result.data) {
    if (result.data.apple) {
      appleKeyId.value = result.data.apple.keyId
      appleIssuerId.value = result.data.apple.issuerId
      appleAppId.value = result.data.apple.appId || ''
      appleHasKey.value = result.data.apple.hasPrivateKey
    }
    if (result.data.google) {
      googlePackageName.value = result.data.google.packageName
      googleHasAccount.value = result.data.google.hasServiceAccount
      googleSavedAccount.value = result.data.google.hasServiceAccount
    }
  }
  const settings = await googleApi.getSettings(props.projectId)
  if (settings.success && settings.data) {
    googleDefaultLanguage.value = settings.data.defaultLanguage || ''
    googleBaseRegion.value = settings.data.baseRegion || ''
  }
  // Load supported regions for the priority-region dropdown.
  if (googleSavedAccount.value) {
    googleRegionsLoading.value = true
    const regionsResult = await googleApi.getRegions(props.projectId)
    googleRegionsLoading.value = false
    if (regionsResult.success && regionsResult.data) {
      googleRegions.value = regionsResult.data
    } else {
      notify.error(regionsResult.error || t('credentials.google.toast.regionLoadFail'))
    }
  }
})

async function onGoogleBaseRegionChange(value: string) {
  googleBaseRegion.value = value
  const result = await googleApi.setBaseRegion(props.projectId, value || null)
  if (result.success) {
    notify.success(t('credentials.google.toast.baseRegionUpdateSuccess'))
  } else {
    notify.error(result.error || t('credentials.google.toast.baseRegionUpdateFail'))
  }
}

async function onGoogleLanguageChange(value: string) {
  googleDefaultLanguage.value = value
  const result = await googleApi.setDefaultLanguage(props.projectId, value || null)
  if (result.success) {
    notify.success(t('credentials.google.toast.languageUpdateSuccess'))
  } else {
    notify.error(result.error || t('credentials.google.toast.languageUpdateFail'))
  }
}

async function detectGoogleLanguage() {
  if (!googleSavedAccount.value) {
    notify.error(t('credentials.google.toast.saveCredsFirst'))
    return
  }
  googleDetectingLanguage.value = true
  const result = await googleApi.detectDefaultLanguage(props.projectId)
  googleDetectingLanguage.value = false
  if (result.success && result.data) {
    googleDefaultLanguage.value = result.data.defaultLanguage
    notify.success(
      t('credentials.google.toast.detectSuccess', { language: result.data.defaultLanguage })
    )
  } else {
    notify.error(result.error || t('credentials.google.toast.detectFail'))
  }
}

async function importP8() {
  const result = await dialogApi.importFile([{ name: 'Apple Private Key', extensions: ['p8'] }])
  if (result.success && result.data) {
    appleP8Content.value = result.data
    appleHasKey.value = true
    notify.info(t('credentials.apple.toast.p8Imported'))
  }
}

async function saveApple() {
  if (!appleKeyId.value || !appleIssuerId.value) {
    notify.error(t('credentials.apple.toast.fillIds'))
    return
  }
  if (!appleP8Content.value && !appleHasKey.value) {
    notify.error(t('credentials.apple.toast.importP8First'))
    return
  }

  const creds: {
    keyId: string
    issuerId: string
    appId: string
    privateKey?: string
  } = {
    keyId: appleKeyId.value,
    issuerId: appleIssuerId.value,
    appId: appleAppId.value
  }
  if (appleP8Content.value) {
    creds.privateKey = appleP8Content.value
  }

  const result = await credentialApi.saveApple(props.projectId, creds)
  if (result.success) {
    notify.success(t('credentials.apple.toast.saveSuccess'))
  } else {
    notify.error(result.error || t('credentials.apple.toast.saveFail'))
  }
}

async function testApple() {
  appleTesting.value = true
  const result = await credentialApi.testApple(props.projectId)
  appleTesting.value = false
  if (result.success) {
    notify.success(result.message || t('credentials.apple.toast.testSuccess'))
  } else {
    notify.error(result.error || t('credentials.apple.toast.testFail'))
  }
}

async function importGoogleJson() {
  const result = await dialogApi.importFile([
    { name: 'Google Service Account', extensions: ['json'] }
  ])
  if (result.success && result.data) {
    googleJsonContent.value = result.data
    googleHasAccount.value = true
    notify.info(t('credentials.google.toast.jsonImported'))
  }
}

async function saveGoogle() {
  if (!googlePackageName.value) {
    notify.error(t('credentials.google.toast.fillPackageName'))
    return
  }
  if (!googleJsonContent.value && !googleHasAccount.value) {
    notify.error(t('credentials.google.toast.importJsonFirst'))
    return
  }

  const creds: {
    packageName: string
    serviceAccountJson?: string
  } = {
    packageName: googlePackageName.value
  }
  if (googleJsonContent.value) {
    creds.serviceAccountJson = googleJsonContent.value
  }

  const result = await credentialApi.saveGoogle(props.projectId, creds)
  if (result.success) {
    googleSavedAccount.value = true
    notify.success(t('credentials.google.toast.saveSuccess'))
  } else {
    notify.error(result.error || t('credentials.google.toast.saveFail'))
  }
}

async function testGoogle() {
  googleTesting.value = true
  const result = await credentialApi.testGoogle(props.projectId)
  googleTesting.value = false
  if (result.success) {
    notify.success(result.message || t('credentials.google.toast.testSuccess'))
  } else {
    notify.error(result.error || t('credentials.google.toast.testFail'))
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Apple Section -->
    <section class="rounded-xl border border-[#393b40] bg-[#2b2d30] p-6">
      <h3 class="mb-4 text-lg font-semibold text-gray-100">
        {{ t('credentials.apple.sectionTitle') }}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">{{
            t('credentials.apple.keyIdLabel')
          }}</label>
          <input
            v-model="appleKeyId"
            type="text"
            class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            :placeholder="t('credentials.apple.keyIdPlaceholder')"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">{{
            t('credentials.apple.issuerIdLabel')
          }}</label>
          <input
            v-model="appleIssuerId"
            type="text"
            class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            :placeholder="t('credentials.apple.issuerIdPlaceholder')"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">{{
            t('credentials.apple.appIdLabel')
          }}</label>
          <input
            v-model="appleAppId"
            type="text"
            class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            :placeholder="t('credentials.apple.appIdPlaceholder')"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">{{
            t('credentials.apple.privateKeyLabel')
          }}</label>
          <div class="flex items-center gap-3">
            <button
              class="rounded-lg border border-[#43454a] px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-[#393b40]"
              @click="importP8"
            >
              {{ t('credentials.apple.importP8') }}
            </button>
            <span v-if="appleHasKey" class="text-sm text-green-400">
              &#10003; {{ t('credentials.apple.configured') }}
            </span>
            <span v-else class="text-sm text-gray-500">
              {{ t('credentials.apple.notConfigured') }}
            </span>
          </div>
        </div>
        <div class="flex gap-2 pt-2">
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
            @click="saveApple"
          >
            {{ t('credentials.apple.saveButton') }}
          </button>
          <button
            :disabled="appleTesting"
            class="rounded-lg border border-[#43454a] px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
            @click="testApple"
          >
            {{ appleTesting ? t('credentials.apple.testing') : t('credentials.apple.testButton') }}
          </button>
        </div>
      </div>
    </section>

    <!-- Google Section -->
    <section class="rounded-xl border border-[#393b40] bg-[#2b2d30] p-6">
      <h3 class="mb-4 text-lg font-semibold text-gray-100">
        {{ t('credentials.google.sectionTitle') }}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">{{
            t('credentials.google.packageNameLabel')
          }}</label>
          <input
            v-model="googlePackageName"
            type="text"
            class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            :placeholder="t('credentials.google.packageNamePlaceholder')"
          />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">{{
            t('credentials.google.jsonLabel')
          }}</label>
          <div class="flex items-center gap-3">
            <button
              class="rounded-lg border border-[#43454a] px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-[#393b40]"
              @click="importGoogleJson"
            >
              {{ t('credentials.google.importJson') }}
            </button>
            <span v-if="googleHasAccount" class="text-sm text-green-400">
              &#10003; {{ t('credentials.google.configured') }}
            </span>
            <span v-else class="text-sm text-gray-500">
              {{ t('credentials.google.notConfigured') }}
            </span>
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">
            {{ t('credentials.google.defaultLanguageLabel') }}
            <span class="ml-1 text-xs font-normal text-gray-500">
              {{ t('credentials.google.defaultLanguageHint') }}
            </span>
          </label>
          <div class="flex items-center gap-2">
            <div class="flex-1">
              <SearchableSelect
                :model-value="googleDefaultLanguage"
                :options="languageOptions"
                :placeholder="t('credentials.google.defaultLanguageNotSet')"
                @update:model-value="onGoogleLanguageChange"
              />
            </div>
            <button
              :disabled="googleDetectingLanguage || !googleSavedAccount"
              class="rounded-lg border border-[#43454a] px-3 py-1.5 text-sm whitespace-nowrap text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
              @click="detectGoogleLanguage"
            >
              {{
                googleDetectingLanguage
                  ? t('credentials.google.detecting')
                  : t('credentials.google.detectFromPlay')
              }}
            </button>
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium text-gray-400">
            {{ t('credentials.google.baseRegionLabel') }}
            <span class="ml-1 text-xs font-normal text-gray-500">
              {{ t('credentials.google.baseRegionHint') }}
            </span>
          </label>
          <SearchableSelect
            :model-value="googleBaseRegion"
            :options="regionOptions"
            :placeholder="
              googleRegionsLoading
                ? t('credentials.google.baseRegionLoading')
                : t('credentials.google.baseRegionNotSet')
            "
            @update:model-value="onGoogleBaseRegionChange"
          />
        </div>
        <div class="flex gap-2 pt-2">
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
            @click="saveGoogle"
          >
            {{ t('credentials.google.saveButton') }}
          </button>
          <button
            :disabled="googleTesting"
            class="rounded-lg border border-[#43454a] px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-[#393b40] disabled:opacity-50"
            @click="testGoogle"
          >
            {{
              googleTesting ? t('credentials.google.testing') : t('credentials.google.testButton')
            }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
