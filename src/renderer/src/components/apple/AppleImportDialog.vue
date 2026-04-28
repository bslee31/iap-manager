<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import * as appleApi from '../../services/api/apple'
import * as progressApi from '../../services/api/progress'

const { t, te } = useI18n()

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
  priceSchedule?: {
    baseTerritory: string
    basePrice: string
    customPrices?: { territory: string; price: string }[]
  }
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
    fatalError.value = res.error || t('apple.import.toast.validationFail')
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
  importProgress.value = t('apple.import.progressPreparing')
  try {
    // Deep-clone to strip Vue reactive proxies — Electron IPC cannot
    // structured-clone a reactive wrapper.
    const rawProducts = JSON.parse(JSON.stringify(preview.value.products))
    const rawCurrencyMap = JSON.parse(JSON.stringify(preview.value.territoryCurrencyMap || {}))
    const res = await appleApi.executeImport(props.projectId, rawProducts, rawCurrencyMap)
    if (!res.success) {
      fatalError.value = res.error || t('apple.import.toast.importFail')
      state.value = 'done'
      return
    }
    results.value = res.data.results
    state.value = 'done'
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    fatalError.value = t('apple.import.toast.ipcFail', { detail })
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
  const key = `apple.import.step.${step}`
  return te(key) ? t(key) : step
}

function typeLabel(type: string): string {
  const key = `apple.type.${type}`
  return te(key) ? t(key) : type
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
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    @click.self="onBackdropClick"
  >
    <div
      class="titlebar-no-drag border-divider bg-card flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border shadow-xl"
    >
      <!-- Header -->
      <div class="border-divider flex shrink-0 items-center justify-between border-b p-6">
        <h3 class="text-lg font-semibold text-gray-100">
          {{ t(`apple.import.header.${state}`) }}
        </h3>
        <button
          v-if="state !== 'importing'"
          class="hover:bg-divider rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:text-gray-300"
          @click="close"
        >
          &times;
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-6">
        <!-- Validating -->
        <div v-if="state === 'validating'" class="flex items-center gap-3 text-gray-400">
          <span
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
          />
          {{ t('apple.import.validating') }}
        </div>

        <!-- Validation errors -->
        <div v-else-if="state === 'validationError'">
          <p v-if="fatalError" class="mb-4 text-sm text-red-400">{{ fatalError }}</p>

          <div
            v-if="preview && (preview.formatVersion || preview.exportedAt || preview.appId)"
            class="mb-4 space-y-1 text-xs text-gray-500"
          >
            <div v-if="preview.formatVersion">Format Version：{{ preview.formatVersion }}</div>
            <div v-if="preview.exportedAt">Exported At：{{ formatDate(preview.exportedAt) }}</div>
            <div v-if="preview.appId">App ID：{{ preview.appId }}</div>
          </div>

          <p v-if="preview && preview.issues.length > 0" class="mb-3 text-sm text-gray-300">
            {{
              t('apple.import.issuesIntro', {
                issues: preview.issues.length,
                products: issuesByProduct.length
              })
            }}
          </p>

          <div v-if="preview" class="space-y-3">
            <div
              v-for="group in issuesByProduct"
              :key="group.key"
              class="bg-deep rounded-lg border border-red-900/40 p-3"
            >
              <div class="mb-2 font-mono text-sm text-gray-300">
                <span class="text-gray-500">#{{ group.index + 1 }}</span>
                {{ group.productId || '(unknown productId)' }}
              </div>
              <ul class="space-y-1">
                <li v-for="(iss, idx) in group.items" :key="idx" class="text-xs text-red-400">
                  <span class="font-mono text-gray-500">{{ iss.field }}</span
                  >：{{ iss.message }}
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Preview -->
        <div v-else-if="state === 'preview' && preview">
          <!-- File meta -->
          <div class="mb-4 space-y-1 text-xs text-gray-500">
            <div>Format Version：{{ preview.formatVersion }}</div>
            <div>Exported At：{{ formatDate(preview.exportedAt) }}</div>
            <div>App ID：{{ preview.appId }}</div>
          </div>

          <p class="mb-3 text-sm text-gray-300">
            {{ t('apple.import.productsIntro', { count: preview.products.length }) }}
          </p>

          <!-- Products table -->
          <div class="border-divider bg-deep overflow-hidden rounded-lg border">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-divider bg-table-head border-b">
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Product ID
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Reference Name
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Type
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    {{ t('apple.detail.tabs.availability') }}
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Price
                  </th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Loc.
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in preview.products"
                  :key="p.productId"
                  class="border-divider border-b last:border-0"
                >
                  <td class="px-3 py-2 font-mono text-gray-200">{{ p.productId }}</td>
                  <td class="px-3 py-2 text-gray-300">{{ p.referenceName }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ typeLabel(p.type) }}</td>
                  <td class="px-3 py-2 text-gray-400">{{ p.availability.territories.length }}</td>
                  <td class="px-3 py-2 font-mono text-gray-400">
                    {{ formatPrice(p.priceSchedule) }}
                  </td>
                  <td class="px-3 py-2 text-gray-400">{{ p.localizations?.length ?? 0 }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Importing -->
        <div v-else-if="state === 'importing'" class="flex flex-col items-center gap-4 py-10">
          <span
            class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-400 border-t-transparent"
          />
          <div class="text-sm text-gray-300">{{ importProgress }}</div>
          <div class="text-xs text-gray-500">{{ t('apple.import.importingHint') }}</div>
        </div>

        <!-- Done -->
        <div v-else-if="state === 'done'">
          <p v-if="fatalError" class="mb-4 text-sm text-red-400">{{ fatalError }}</p>

          <div class="mb-4 grid grid-cols-3 gap-3">
            <div class="rounded-lg border border-green-600/30 bg-green-600/10 p-3">
              <div class="mb-1 text-xs text-green-400 uppercase">
                {{ t('apple.import.stats.fullSuccess') }}
              </div>
              <div class="text-2xl font-semibold text-green-300">{{ stats.fullSuccess }}</div>
            </div>
            <div class="rounded-lg border border-yellow-600/30 bg-yellow-600/10 p-3">
              <div class="mb-1 text-xs text-yellow-400 uppercase">
                {{ t('apple.import.stats.partial') }}
              </div>
              <div class="text-2xl font-semibold text-yellow-300">{{ stats.partial }}</div>
            </div>
            <div class="rounded-lg border border-red-600/30 bg-red-600/10 p-3">
              <div class="mb-1 text-xs text-red-400 uppercase">
                {{ t('apple.import.stats.failed') }}
              </div>
              <div class="text-2xl font-semibold text-red-300">{{ stats.failed }}</div>
            </div>
          </div>

          <!-- Failed products -->
          <div v-if="stats.failed > 0" class="mb-4">
            <h4 class="mb-2 text-sm font-medium text-red-400">
              {{ t('apple.import.failedTitle', { count: stats.failed }) }}
            </h4>
            <div class="space-y-2">
              <div
                v-for="r in results.filter((x) => !x.created)"
                :key="r.productId"
                class="bg-deep rounded-lg border border-red-900/40 p-3"
              >
                <div class="font-mono text-sm text-gray-300">{{ r.productId }}</div>
                <div class="mb-1 text-xs text-gray-500">{{ r.referenceName }}</div>
                <ul class="space-y-1">
                  <li v-for="(se, idx) in r.stepErrors" :key="idx" class="text-xs text-red-400">
                    <span class="text-gray-500"
                      >[{{ stepLabel(se.step) }}{{ se.target ? ` - ${se.target}` : '' }}]</span
                    >
                    {{ se.error }}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Partial-success products -->
          <div v-if="stats.partial > 0">
            <h4 class="mb-2 text-sm font-medium text-yellow-400">
              {{ t('apple.import.partialTitle', { count: stats.partial }) }}
            </h4>
            <div class="space-y-2">
              <div
                v-for="r in results.filter((x) => x.created && x.stepErrors.length > 0)"
                :key="r.productId"
                class="bg-deep rounded-lg border border-yellow-900/40 p-3"
              >
                <div class="font-mono text-sm text-gray-300">{{ r.productId }}</div>
                <div class="mb-1 text-xs text-gray-500">{{ r.referenceName }}</div>
                <ul class="space-y-1">
                  <li v-for="(se, idx) in r.stepErrors" :key="idx" class="text-xs text-yellow-400">
                    <span class="text-gray-500"
                      >[{{ stepLabel(se.step) }}{{ se.target ? ` - ${se.target}` : '' }}]</span
                    >
                    {{ se.error }}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div v-if="stats.total === 0 && !fatalError" class="text-sm text-gray-400">
            {{ t('apple.import.noResults') }}
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div
        v-if="state !== 'validating' && state !== 'importing'"
        class="border-divider flex shrink-0 justify-end gap-2 border-t p-4"
      >
        <template v-if="state === 'preview'">
          <button
            class="hover:bg-divider rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors"
            @click="close"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
            @click="confirmImport"
          >
            {{ t('apple.import.confirmImport') }}
          </button>
        </template>
        <template v-else>
          <button
            class="border-divider-strong hover:bg-divider rounded-lg border px-4 py-2 text-sm text-gray-300 transition-colors"
            @click="close"
          >
            {{ t('common.close') }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
