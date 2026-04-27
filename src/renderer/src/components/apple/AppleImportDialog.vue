<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import * as appleApi from '../../services/api/apple'
import * as progressApi from '../../services/api/progress'

interface ImportValidationIssue {
  index: number
  productId?: string
  field: string
  message: string
}

interface ImportedProduct {
  productId: string
  referenceName: string
  type: string
  availability: { territories: string[]; availableInNewTerritories: boolean }
  priceSchedule?: { baseTerritory: string; basePrice: string; customPrices?: { territory: string; price: string }[] }
  localizations?: { locale: string; name: string; description: string }[]
}

interface ImportPreview {
  valid: boolean
  formatVersion?: number
  exportedAt?: string
  appId?: string
  products: ImportedProduct[]
  issues: ImportValidationIssue[]
  territoryCurrencyMap?: Record<string, string>
}

interface ImportStepError {
  step: string
  target?: string
  error: string
}

interface ImportProductResult {
  productId: string
  referenceName: string
  created: boolean
  iapId?: string
  stepErrors: ImportStepError[]
  createdState?: string
  availabilityApplied: boolean
  priceApplied: boolean
}

const props = defineProps<{
  projectId: string
  fileContent: string
  existingProductIds: string[]
}>()

const emit = defineEmits<{
  close: []
  imported: []
}>()

type State = 'validating' | 'validationError' | 'preview' | 'importing' | 'done'
const state = ref<State>('validating')
const preview = ref<ImportPreview | null>(null)
const importProgress = ref('')
const results = ref<ImportProductResult[]>([])
const fatalError = ref('')

let cleanupProgress: (() => void) | null = null

onMounted(async () => {
  cleanupProgress = progressApi.onImport((data) => {
    importProgress.value = data.phase
  })
  const res = await appleApi.validateImport(
    props.projectId,
    props.fileContent,
    props.existingProductIds
  )
  if (!res.success) {
    fatalError.value = res.error || '驗證失敗'
    state.value = 'validationError'
    preview.value = { valid: false, products: [], issues: [] }
    return
  }
  preview.value = res.data
  state.value = res.data.valid ? 'preview' : 'validationError'
})

onUnmounted(() => {
  cleanupProgress?.()
})

const issuesByProduct = computed(() => {
  const groups = new Map<string, ImportValidationIssue[]>()
  for (const iss of preview.value?.issues || []) {
    const key = iss.productId ? `${iss.index}::${iss.productId}` : `${iss.index}::(unknown)`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(iss)
  }
  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    productId: items[0].productId,
    index: items[0].index,
    items
  }))
})

const stats = computed(() => {
  const r = results.value
  const fullSuccess = r.filter((x) => x.created && x.stepErrors.length === 0).length
  const partial = r.filter((x) => x.created && x.stepErrors.length > 0).length
  const failed = r.filter((x) => !x.created).length
  return { fullSuccess, partial, failed, total: r.length }
})

async function confirmImport(): Promise<void> {
  if (!preview.value) return
  state.value = 'importing'
  importProgress.value = '準備匯入...'
  try {
    // Deep-clone to strip Vue reactive proxies — Electron IPC cannot
    // structured-clone a reactive wrapper.
    const rawProducts = JSON.parse(JSON.stringify(preview.value.products))
    const rawCurrencyMap = JSON.parse(JSON.stringify(preview.value.territoryCurrencyMap || {}))
    const res = await appleApi.executeImport(
      props.projectId,
      rawProducts,
      rawCurrencyMap
    )
    if (!res.success) {
      fatalError.value = res.error || '匯入失敗'
      state.value = 'done'
      return
    }
    results.value = res.data.results
    state.value = 'done'
  } catch (e: any) {
    fatalError.value = `IPC 呼叫失敗: ${e?.message || String(e)}`
    state.value = 'done'
  }
}

function close(): void {
  // Trigger re-sync if any product was created
  if (results.value.some((r) => r.created)) {
    emit('imported')
  }
  emit('close')
}

function onBackdropClick(): void {
  // Prevent accidental dismissal during import execution
  if (state.value === 'importing') return
  close()
}

function stepLabel(step: string): string {
  const map: Record<string, string> = {
    create: '建立商品',
    availability: '設定 Availability',
    price: '設定 Base Price',
    customPrice: '設定自訂價格',
    localization: '建立 Localization'
  }
  return map[step] || step
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    CONSUMABLE: '消耗型',
    NON_CONSUMABLE: '非消耗型',
    NON_RENEWING_SUBSCRIPTION: '非續訂型訂閱'
  }
  return map[type] || type
}

function formatPrice(ps?: ImportedProduct['priceSchedule']): string {
  if (!ps) return '-'
  const currency = preview.value?.territoryCurrencyMap?.[ps.baseTerritory]
  return currency ? `${ps.basePrice} ${currency}` : `${ps.basePrice} (${ps.baseTerritory})`
}

function formatDate(iso?: string): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('zh-TW')
  } catch {
    return iso
  }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="onBackdropClick">
    <div class="bg-[#2b2d30] rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-[#393b40] titlebar-no-drag">
      <!-- Header -->
      <div class="flex items-center justify-between p-6 border-b border-[#393b40] shrink-0">
        <h3 class="text-lg font-semibold text-gray-100">
          <template v-if="state === 'validating'">驗證檔案中...</template>
          <template v-else-if="state === 'validationError'">匯入檔案有問題</template>
          <template v-else-if="state === 'preview'">確認匯入</template>
          <template v-else-if="state === 'importing'">匯入中</template>
          <template v-else-if="state === 'done'">匯入結果</template>
        </h3>
        <button
          v-if="state !== 'importing'"
          @click="close"
          class="text-gray-500 hover:text-gray-300 text-xl leading-none p-2 rounded hover:bg-[#393b40] transition-colors"
        >
          &times;
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-6">
        <!-- Validating -->
        <div v-if="state === 'validating'" class="flex items-center gap-3 text-gray-400">
          <span class="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          讀取並驗證檔案中...
        </div>

        <!-- Validation errors -->
        <div v-else-if="state === 'validationError'">
          <p v-if="fatalError" class="text-red-400 text-sm mb-4">{{ fatalError }}</p>

          <div v-if="preview && (preview.formatVersion || preview.exportedAt || preview.appId)" class="mb-4 text-xs text-gray-500 space-y-1">
            <div v-if="preview.formatVersion">Format Version：{{ preview.formatVersion }}</div>
            <div v-if="preview.exportedAt">Exported At：{{ formatDate(preview.exportedAt) }}</div>
            <div v-if="preview.appId">App ID：{{ preview.appId }}</div>
          </div>

          <p v-if="preview && preview.issues.length > 0" class="text-sm text-gray-300 mb-3">
            發現 {{ preview.issues.length }} 個問題（{{ issuesByProduct.length }} 筆商品），請修正後重新匯入：
          </p>

          <div v-if="preview" class="space-y-3">
            <div
              v-for="group in issuesByProduct"
              :key="group.key"
              class="bg-[#1e1f22] border border-red-900/40 rounded-lg p-3"
            >
              <div class="text-sm font-mono text-gray-300 mb-2">
                <span class="text-gray-500">#{{ group.index + 1 }}</span>
                {{ group.productId || '(unknown productId)' }}
              </div>
              <ul class="space-y-1">
                <li
                  v-for="(iss, idx) in group.items"
                  :key="idx"
                  class="text-xs text-red-400"
                >
                  <span class="font-mono text-gray-500">{{ iss.field }}</span>：{{ iss.message }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Preview -->
        <div v-else-if="state === 'preview' && preview">
          <!-- File meta -->
          <div class="mb-4 text-xs text-gray-500 space-y-1">
            <div>Format Version：{{ preview.formatVersion }}</div>
            <div>Exported At：{{ formatDate(preview.exportedAt) }}</div>
            <div>App ID：{{ preview.appId }}</div>
          </div>

          <p class="text-sm text-gray-300 mb-3">
            將匯入 <span class="text-blue-400 font-semibold">{{ preview.products.length }}</span> 個商品：
          </p>

          <!-- Products table -->
          <div class="bg-[#1e1f22] border border-[#393b40] rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-[#22252a] border-b border-[#393b40]">
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Product ID</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Reference Name</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">地區</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Price</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Loc.</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in preview.products"
                  :key="p.productId"
                  class="border-b border-[#393b40] last:border-0"
                >
                  <td class="px-3 py-2 font-mono text-gray-200">{{ p.productId }}</td>
                  <td class="px-3 py-2 text-gray-300">{{ p.referenceName }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ typeLabel(p.type) }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ p.availability.territories.length }}</td>
                  <td class="px-3 py-2 text-gray-400 font-mono">
                    {{ formatPrice(p.priceSchedule) }}
                  </td>
                  <td class="px-3 py-2 text-gray-400">{{ p.localizations?.length ?? 0 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Importing -->
        <div v-else-if="state === 'importing'" class="flex flex-col items-center py-10 gap-4">
          <span class="inline-block w-8 h-8 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <div class="text-sm text-gray-300">{{ importProgress }}</div>
          <div class="text-xs text-gray-500">匯入過程請勿關閉視窗</div>
        </div>

        <!-- Done -->
        <div v-else-if="state === 'done'">
          <p v-if="fatalError" class="text-red-400 text-sm mb-4">{{ fatalError }}</p>

          <div class="grid grid-cols-3 gap-3 mb-4">
            <div class="bg-green-600/10 border border-green-600/30 rounded-lg p-3">
              <div class="text-xs text-green-400 uppercase mb-1">完全成功</div>
              <div class="text-2xl font-semibold text-green-300">{{ stats.fullSuccess }}</div>
            </div>
            <div class="bg-yellow-600/10 border border-yellow-600/30 rounded-lg p-3">
              <div class="text-xs text-yellow-400 uppercase mb-1">部分成功</div>
              <div class="text-2xl font-semibold text-yellow-300">{{ stats.partial }}</div>
            </div>
            <div class="bg-red-600/10 border border-red-600/30 rounded-lg p-3">
              <div class="text-xs text-red-400 uppercase mb-1">建立失敗</div>
              <div class="text-2xl font-semibold text-red-300">{{ stats.failed }}</div>
            </div>
          </div>

          <!-- Failed products -->
          <div v-if="stats.failed > 0" class="mb-4">
            <h4 class="text-sm font-medium text-red-400 mb-2">建立失敗（{{ stats.failed }}）</h4>
            <div class="space-y-2">
              <div
                v-for="r in results.filter((x) => !x.created)"
                :key="r.productId"
                class="bg-[#1e1f22] border border-red-900/40 rounded-lg p-3"
              >
                <div class="text-sm font-mono text-gray-300">{{ r.productId }}</div>
                <div class="text-xs text-gray-500 mb-1">{{ r.referenceName }}</div>
                <ul class="space-y-1">
                  <li v-for="(se, idx) in r.stepErrors" :key="idx" class="text-xs text-red-400">
                    <span class="text-gray-500">[{{ stepLabel(se.step) }}{{ se.target ? ` - ${se.target}` : '' }}]</span>
                    {{ se.error }}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Partial-success products -->
          <div v-if="stats.partial > 0">
            <h4 class="text-sm font-medium text-yellow-400 mb-2">商品已建立，但部分步驟失敗（{{ stats.partial }}）</h4>
            <div class="space-y-2">
              <div
                v-for="r in results.filter((x) => x.created && x.stepErrors.length > 0)"
                :key="r.productId"
                class="bg-[#1e1f22] border border-yellow-900/40 rounded-lg p-3"
              >
                <div class="text-sm font-mono text-gray-300">{{ r.productId }}</div>
                <div class="text-xs text-gray-500 mb-1">{{ r.referenceName }}</div>
                <ul class="space-y-1">
                  <li v-for="(se, idx) in r.stepErrors" :key="idx" class="text-xs text-yellow-400">
                    <span class="text-gray-500">[{{ stepLabel(se.step) }}{{ se.target ? ` - ${se.target}` : '' }}]</span>
                    {{ se.error }}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div v-if="stats.total === 0 && !fatalError" class="text-gray-400 text-sm">
            沒有匯入結果
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div v-if="state !== 'validating' && state !== 'importing'" class="flex justify-end gap-2 p-4 border-t border-[#393b40] shrink-0">
        <template v-if="state === 'preview'">
          <button
            @click="close"
            class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            @click="confirmImport"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
          >
            確認匯入
          </button>
        </template>
        <template v-else>
          <button
            @click="close"
            class="px-4 py-2 text-sm text-gray-300 border border-[#43454a] hover:bg-[#393b40] rounded-lg transition-colors"
          >
            關閉
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
