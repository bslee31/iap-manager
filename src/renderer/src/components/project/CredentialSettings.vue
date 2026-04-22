<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useNotificationStore } from '../../stores/notification.store'
import SearchableSelect from '../common/SearchableSelect.vue'
import { GOOGLE_LANGUAGES } from '../../utils/google-languages'

const props = defineProps<{ projectId: string }>()
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

const languageOptions = computed(() =>
  GOOGLE_LANGUAGES.map((l) => ({
    value: l.code,
    label: l.label,
    right: l.code
  }))
)

onMounted(async () => {
  const result = await window.api.getCredentials(props.projectId)
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
  const settings = await window.api.getGoogleSettings(props.projectId)
  if (settings.success && settings.data) {
    googleDefaultLanguage.value = settings.data.defaultLanguage || ''
  }
})

async function onGoogleLanguageChange(value: string) {
  googleDefaultLanguage.value = value
  const result = await window.api.setGoogleDefaultLanguage(props.projectId, value || null)
  if (result.success) {
    notify.success('已更新預設語言')
  } else {
    notify.error(result.error || '儲存預設語言失敗')
  }
}

async function detectGoogleLanguage() {
  if (!googleSavedAccount.value) {
    notify.error('請先儲存 Google 憑證')
    return
  }
  googleDetectingLanguage.value = true
  const result = await window.api.detectGoogleDefaultLanguage(props.projectId)
  googleDetectingLanguage.value = false
  if (result.success && result.data) {
    googleDefaultLanguage.value = result.data.defaultLanguage
    notify.success(`已從 Play Console 偵測到預設語言：${result.data.defaultLanguage}`)
  } else {
    notify.error(result.error || '偵測失敗')
  }
}

async function importP8() {
  const result = await window.api.importFile([
    { name: 'Apple Private Key', extensions: ['p8'] }
  ])
  if (result.success && result.data) {
    appleP8Content.value = result.data
    appleHasKey.value = true
    notify.info('已匯入 .p8 檔案')
  }
}

async function saveApple() {
  if (!appleKeyId.value || !appleIssuerId.value) {
    notify.error('請填寫 Key ID 和 Issuer ID')
    return
  }
  if (!appleP8Content.value && !appleHasKey.value) {
    notify.error('請匯入 .p8 私鑰檔案')
    return
  }

  const creds: any = {
    keyId: appleKeyId.value,
    issuerId: appleIssuerId.value,
    appId: appleAppId.value
  }
  if (appleP8Content.value) {
    creds.privateKey = appleP8Content.value
  }

  const result = await window.api.saveAppleCredentials(props.projectId, creds)
  if (result.success) {
    notify.success('Apple 憑證已儲存')
  } else {
    notify.error(result.error || '儲存失敗')
  }
}

async function testApple() {
  appleTesting.value = true
  const result = await window.api.testAppleConnection(props.projectId)
  appleTesting.value = false
  if (result.success) {
    notify.success(result.message || '連線成功')
  } else {
    notify.error(result.error || '連線失敗')
  }
}

async function importGoogleJson() {
  const result = await window.api.importFile([
    { name: 'Google Service Account', extensions: ['json'] }
  ])
  if (result.success && result.data) {
    googleJsonContent.value = result.data
    googleHasAccount.value = true
    notify.info('已匯入 Service Account JSON')
  }
}

async function saveGoogle() {
  if (!googlePackageName.value) {
    notify.error('請填寫 Package Name')
    return
  }
  if (!googleJsonContent.value && !googleHasAccount.value) {
    notify.error('請匯入 Service Account JSON')
    return
  }

  const creds: any = {
    packageName: googlePackageName.value
  }
  if (googleJsonContent.value) {
    creds.serviceAccountJson = googleJsonContent.value
  }

  const result = await window.api.saveGoogleCredentials(props.projectId, creds)
  if (result.success) {
    googleSavedAccount.value = true
    notify.success('Google 憑證已儲存')
  } else {
    notify.error(result.error || '儲存失敗')
  }
}

async function testGoogle() {
  googleTesting.value = true
  const result = await window.api.testGoogleConnection(props.projectId)
  googleTesting.value = false
  if (result.success) {
    notify.success(result.message || '連線成功')
  } else {
    notify.error(result.error || '連線失敗')
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Apple Section -->
    <section class="bg-[#2b2d30] rounded-xl border border-[#393b40] p-6">
      <h3 class="text-lg font-semibold text-gray-100 mb-4">Apple App Store Connect</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-1">Key ID</label>
          <input
            v-model="appleKeyId"
            type="text"
            class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            placeholder="例：ABC1234DEF"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-1">Issuer ID</label>
          <input
            v-model="appleIssuerId"
            type="text"
            class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            placeholder="例：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-1">App ID</label>
          <input
            v-model="appleAppId"
            type="text"
            class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            placeholder="例：1234567890"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-1">私鑰檔案 (.p8)</label>
          <div class="flex items-center gap-3">
            <button
              @click="importP8"
              class="px-4 py-2 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors"
            >
              匯入 .p8 檔案
            </button>
            <span v-if="appleHasKey" class="text-sm text-green-400">&#10003; 已設定</span>
            <span v-else class="text-sm text-gray-500">未設定</span>
          </div>
        </div>
        <div class="flex gap-2 pt-2">
          <button
            @click="saveApple"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
          >
            儲存 Apple 憑證
          </button>
          <button
            @click="testApple"
            :disabled="appleTesting"
            class="px-4 py-2 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors disabled:opacity-50"
          >
            {{ appleTesting ? '測試中...' : '測試連線' }}
          </button>
        </div>
      </div>
    </section>

    <!-- Google Section -->
    <section class="bg-[#2b2d30] rounded-xl border border-[#393b40] p-6">
      <h3 class="text-lg font-semibold text-gray-100 mb-4">Google Play Console</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-1">Package Name</label>
          <input
            v-model="googlePackageName"
            type="text"
            class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            placeholder="例：com.example.myapp"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-1">服務帳戶金鑰 (JSON)</label>
          <div class="flex items-center gap-3">
            <button
              @click="importGoogleJson"
              class="px-4 py-2 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors"
            >
              匯入 JSON 檔案
            </button>
            <span v-if="googleHasAccount" class="text-sm text-green-400">&#10003; 已設定</span>
            <span v-else class="text-sm text-gray-500">未設定</span>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-400 mb-1">
            預設語言
            <span class="text-xs text-gray-500 font-normal ml-1">（新增商品時使用的 listing 語言）</span>
          </label>
          <div class="flex items-center gap-2">
            <div class="flex-1">
              <SearchableSelect
                :model-value="googleDefaultLanguage"
                :options="languageOptions"
                placeholder="未設定"
                @update:model-value="onGoogleLanguageChange"
              />
            </div>
            <button
              @click="detectGoogleLanguage"
              :disabled="googleDetectingLanguage || !googleSavedAccount"
              class="px-3 py-1.5 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {{ googleDetectingLanguage ? '偵測中...' : '從 Play Console 偵測' }}
            </button>
          </div>
        </div>
        <div class="flex gap-2 pt-2">
          <button
            @click="saveGoogle"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
          >
            儲存 Google 憑證
          </button>
          <button
            @click="testGoogle"
            :disabled="googleTesting"
            class="px-4 py-2 border border-[#43454a] rounded-lg text-sm text-gray-300 hover:bg-[#393b40] transition-colors disabled:opacity-50"
          >
            {{ googleTesting ? '測試中...' : '測試連線' }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
