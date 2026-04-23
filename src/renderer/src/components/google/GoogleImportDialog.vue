<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface ImportValidationIssue {
  index: number
  productId?: string
  field: string
  message: string
}

interface ImportedListing {
  languageCode: string
  title: string
  description: string
}

interface ImportedRegion {
  regionCode: string
  availability: string
  currencyCode: string
  units: string
  nanos: number
}

interface ImportedPurchaseOption {
  purchaseOptionId: string
  state: string
  type: string
  legacyCompatible: boolean
  regions: ImportedRegion[]
}

interface ImportedProduct {
  productId: string
  listings: ImportedListing[]
  purchaseOptions: ImportedPurchaseOption[]
}

interface ImportPreview {
  valid: boolean
  formatVersion?: number
  exportedAt?: string
  packageName?: string
  products: ImportedProduct[]
  issues: ImportValidationIssue[]
}

interface ImportStepError {
  step: string
  target?: string
  error: string
}

interface ImportProductResult {
  productId: string
  created: boolean
  stepErrors: ImportStepError[]
  skippedRegions: string[]
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
const baseRegion = ref('')
const defaultLanguage = ref('')

onMounted(async () => {
  cleanupProgress = window.api.onImportProgress((data) => {
    importProgress.value = data.phase
  })
  // Resolve the target project's base region (for primary PO price column)
  // and default language (for the Name column), so the preview reflects
  // this project's own reference points — not hardcoded zh-TW/en-US or
  // the alphabetically-first region.
  const settingsRes = await window.api.getGoogleSettings(props.projectId)
  if (settingsRes.success && settingsRes.data) {
    baseRegion.value = settingsRes.data.baseRegion || ''
    defaultLanguage.value = settingsRes.data.defaultLanguage || ''
  }
  const res = await window.api.validateGoogleImport(
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
    const res = await window.api.executeGoogleImport(props.projectId, rawProducts)
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
  if (results.value.some((r) => r.created)) {
    emit('imported')
  }
  emit('close')
}

function onBackdropClick(): void {
  if (state.value === 'importing') return
  close()
}

function stepLabel(step: string): string {
  const map: Record<string, string> = {
    create: '建立商品'
  }
  return map[step] || step
}

function formatPrice(po: ImportedPurchaseOption): string {
  // Prefer the price at the target project's base region — matches how the
  // product list's Price column picks what to show. Falls back to the first
  // region in the exported array if the base region isn't set or isn't
  // present in this PO's regions.
  const pick =
    (baseRegion.value && po.regions.find((r) => r.regionCode === baseRegion.value)) ||
    po.regions[0]
  if (!pick) return '-'
  const frac = Math.round(pick.nanos / 1e7).toString().padStart(2, '0')
  return `${pick.units}.${frac} ${pick.currencyCode}`
}

function primaryPo(p: ImportedProduct): ImportedPurchaseOption | undefined {
  return p.purchaseOptions.find((po) => po.legacyCompatible) || p.purchaseOptions[0]
}

// Pick the representative listing title for the preview row: prefer the
// target project's configured defaultLanguage, otherwise fall back to the
// first listing in the file — no hardcoded locale fallbacks.
function displayName(p: ImportedProduct): string {
  if (p.listings.length === 0) return ''
  const pick =
    (defaultLanguage.value &&
      p.listings.find((l) => l.languageCode === defaultLanguage.value)) ||
    p.listings[0]
  return pick?.title || ''
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
          <span class="inline-block w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
          讀取並驗證檔案中...
        </div>

        <!-- Validation errors -->
        <div v-else-if="state === 'validationError'">
          <p v-if="fatalError" class="text-red-400 text-sm mb-4">{{ fatalError }}</p>

          <div v-if="preview && (preview.formatVersion || preview.exportedAt || preview.packageName)" class="mb-4 text-xs text-gray-500 space-y-1">
            <div v-if="preview.formatVersion">Format Version：{{ preview.formatVersion }}</div>
            <div v-if="preview.exportedAt">Exported At：{{ formatDate(preview.exportedAt) }}</div>
            <div v-if="preview.packageName">Package Name：{{ preview.packageName }}</div>
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
          <div class="mb-4 text-xs text-gray-500 space-y-1">
            <div>Format Version：{{ preview.formatVersion }}</div>
            <div>Exported At：{{ formatDate(preview.exportedAt) }}</div>
            <div>Package Name：{{ preview.packageName }}</div>
          </div>

          <p class="text-sm text-gray-300 mb-3">
            將匯入 <span class="text-green-400 font-semibold">{{ preview.products.length }}</span> 個商品：
          </p>

          <div class="bg-[#1e1f22] border border-[#393b40] rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-[#22252a] border-b border-[#393b40]">
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Product ID</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">POs</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">
                    主 PO 基準價<span v-if="baseRegion"> ({{ baseRegion }})</span>
                  </th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">地區</th>
                  <th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">語言</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in preview.products"
                  :key="p.productId"
                  class="border-b border-[#393b40] last:border-0"
                >
                  <td class="px-3 py-2 font-mono text-gray-200">{{ p.productId }}</td>
                  <td class="px-3 py-2 text-gray-300 truncate max-w-[180px]">{{ displayName(p) }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ p.purchaseOptions.length }}</td>
                  <td class="px-3 py-2 text-gray-400 font-mono">
                    {{ primaryPo(p) ? formatPrice(primaryPo(p)!) : '-' }}
                  </td>
                  <td class="px-3 py-2 text-gray-400">{{ primaryPo(p)?.regions.length ?? 0 }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ p.listings.length }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="text-xs text-gray-500 mt-3">
            匯入的商品一律以 DRAFT 狀態建立。請自行在 Detail 頁確認後再手動上架。
          </p>
        </div>

        <!-- Importing -->
        <div v-else-if="state === 'importing'" class="flex flex-col items-center py-10 gap-4">
          <span class="inline-block w-8 h-8 border-4 border-green-400 border-t-transparent rounded-full animate-spin" />
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
                <ul class="space-y-1 mt-1">
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
                <ul class="space-y-1 mt-1">
                  <li v-for="(se, idx) in r.stepErrors" :key="idx" class="text-xs text-yellow-400">
                    <span class="text-gray-500">[{{ stepLabel(se.step) }}{{ se.target ? ` - ${se.target}` : '' }}]</span>
                    {{ se.error }}
                  </li>
                </ul>
                <p v-if="r.skippedRegions.length > 0" class="text-xs text-gray-500 mt-2">
                  Google 略過的地區（{{ r.skippedRegions.length }}）：{{ r.skippedRegions.join(', ') }}
                </p>
              </div>
            </div>
          </div>

          <!-- Fully successful with skipped regions still worth noting -->
          <div
            v-if="stats.fullSuccess > 0 && results.some((r) => r.created && r.stepErrors.length === 0 && r.skippedRegions.length > 0)"
            class="mt-4"
          >
            <h4 class="text-sm font-medium text-gray-400 mb-2">完成匯入但有略過地區</h4>
            <div class="space-y-2">
              <div
                v-for="r in results.filter((x) => x.created && x.stepErrors.length === 0 && x.skippedRegions.length > 0)"
                :key="r.productId"
                class="bg-[#1e1f22] border border-[#393b40] rounded-lg p-3"
              >
                <div class="text-sm font-mono text-gray-300">{{ r.productId }}</div>
                <p class="text-xs text-gray-500 mt-1">
                  略過地區（{{ r.skippedRegions.length }}）：{{ r.skippedRegions.join(', ') }}
                </p>
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
            class="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
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
