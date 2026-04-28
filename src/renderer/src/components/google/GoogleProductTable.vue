<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../stores/notification.store'
import { useGoogleProductsStore, type GoogleProduct } from '../../stores/google-products.store'
import SearchableSelect from '../common/SearchableSelect.vue'
import { GOOGLE_LANGUAGES } from '../../utils/google-languages'
import GoogleProductDetail from './GoogleProductDetail.vue'
import GoogleImportDialog from './GoogleImportDialog.vue'
import * as googleApi from '../../services/api/google'
import * as dialogApi from '../../services/api/dialog'

const props = defineProps<{ projectId: string }>()
const { t, te } = useI18n()
const notify = useNotificationStore()
const store = useGoogleProductsStore()

const languageOptions = GOOGLE_LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
  right: l.code
}))

// Project settings — kept local because they're only relevant to the create
// form on this screen.
const projectDefaultLanguage = ref('')
const detectingLanguage = ref(false)
const creating = ref(false)

interface RegionInfo {
  regionCode: string
  currencyCode: string
}
const supportedRegions = ref<RegionInfo[]>([])
const loadingRegions = ref(false)

const regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' })
const regionOptions = computed(() =>
  supportedRegions.value
    .map((r) => ({
      value: r.regionCode,
      label: `${regionDisplayNames.of(r.regionCode) || r.regionCode}`,
      right: `${r.regionCode} · ${r.currencyCode}`
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
)

function currencyForRegion(regionCode: string): string {
  return supportedRegions.value.find((r) => r.regionCode === regionCode)?.currencyCode || ''
}

const existingProductIds = computed(() => store.products.map((p) => p.productId))

// Pure UI state — kept local because no other component cares about it.
const importFileContent = ref<string | null>(null)
const showCreateForm = ref(false)
const searchQuery = ref('')
const newProduct = ref({
  productId: '',
  name: '',
  description: '',
  languageCode: '',
  purchaseOptionId: 'base',
  baseRegionCode: '',
  basePrice: ''
})
const activeFilter = ref<string | null>(null)

// Reset on mount AND unmount: project switches re-mount this component, and
// we want the store cleared on the way in (defence against an unclean prior
// unmount) and on the way out (so the next project starts clean).
onMounted(async () => {
  store.reset()
  await Promise.all([store.loadCached(props.projectId), loadProjectSettings()])
})
onUnmounted(() => {
  store.reset()
})

const STATUS_ORDER: Record<string, number> = {
  ACTIVE: 0,
  DRAFT: 1,
  INACTIVE: 2,
  INACTIVE_PUBLISHED: 3,
  NO_PURCHASE_OPTION: 4
}

const statusGroups = computed(() => {
  const counts = new Map<string, number>()
  for (const p of store.products) {
    counts.set(p.status, (counts.get(p.status) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, label: statusLabel(status), count }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
})

const filteredProducts = computed(() => {
  let result = store.products
  if (activeFilter.value) {
    result = result.filter((p) => p.status === activeFilter.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(
      (p) => p.productId.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    )
  }
  return result
})

function setFilter(status: string | null) {
  activeFilter.value = activeFilter.value === status ? null : status
  store.clearSelection()
}

const allSelected = computed(() => {
  return filteredProducts.value.length > 0 && store.selected.size === filteredProducts.value.length
})

const batchActions = computed(() => [
  { key: 'activate', label: t('google.batch.activate') },
  { key: 'deactivate', label: t('google.batch.deactivate'), variant: 'danger' as const }
])

async function loadProjectSettings() {
  const result = await googleApi.getSettings(props.projectId)
  if (result.success && result.data) {
    projectDefaultLanguage.value = result.data.defaultLanguage || ''
  }
}

async function openCreateForm() {
  newProduct.value = {
    productId: '',
    name: '',
    description: '',
    languageCode: projectDefaultLanguage.value,
    purchaseOptionId: 'base',
    baseRegionCode: '',
    basePrice: ''
  }
  showCreateForm.value = true
  if (supportedRegions.value.length === 0) {
    loadingRegions.value = true
    const result = await googleApi.getRegions(props.projectId)
    loadingRegions.value = false
    if (result.success && result.data) {
      supportedRegions.value = result.data
    } else {
      notify.error(result.error || t('google.toast.regionFail'))
    }
  }
}

async function detectLanguageInModal() {
  detectingLanguage.value = true
  const result = await googleApi.detectDefaultLanguage(props.projectId)
  detectingLanguage.value = false
  if (result.success && result.data) {
    projectDefaultLanguage.value = result.data.defaultLanguage
    newProduct.value.languageCode = result.data.defaultLanguage
    notify.success(t('google.toast.detectSuccess', { language: result.data.defaultLanguage }))
  } else {
    notify.error(result.error || t('google.toast.detectFail'))
  }
}

async function syncAll() {
  // Set the initial phase string here (not in the store) so the i18n call
  // stays in the component layer. The main-process progress listener will
  // overwrite this with concrete phase updates as the sync proceeds.
  store.syncProgress = t('google.progress.connecting')
  const result = await store.syncProducts(props.projectId)
  if (result.success) {
    notify.success(t('google.toast.syncSuccess', { count: result.data.length }))
  } else {
    notify.error(result.error || t('google.toast.syncFail'))
  }
}

async function importProducts() {
  const result = await dialogApi.importFile([{ name: 'JSON', extensions: ['json'] }])
  if (!result.success || !result.data) return
  importFileContent.value = result.data
}

async function onImportDone() {
  importFileContent.value = null
  // Re-sync so the list reflects the newly created products (and their
  // status / price via the usual listOneTimeProducts aggregation).
  await syncAll()
}

async function exportProducts() {
  if (store.products.length === 0) {
    notify.error(t('google.toast.exportEmpty'))
    return
  }

  const source =
    store.selected.size > 0
      ? store.products.filter((p) => store.selected.has(p.productId))
      : store.products

  const payload = source.map((p) => ({ productId: p.productId }))

  store.exporting = true
  store.exportProgress = t('google.progress.exportPreparing')
  const result = await googleApi.exportProducts(props.projectId, payload)
  store.exporting = false
  store.exportProgress = ''

  if (!result.success) {
    notify.error(result.error || t('google.toast.exportFail'))
    return
  }

  const data = result.data
  if (data.cancelled) return

  if (data.errors.length > 0) {
    const details = data.errors
      .map((e: { productId: string; error: string }) => `${e.productId}: ${e.error}`)
      .join('\n')
    notify.error(
      t('google.toast.exportPartial', {
        exported: data.exported,
        total: data.total,
        failed: data.errors.length,
        details
      })
    )
  } else {
    notify.success(t('google.toast.exportSuccess', { count: data.exported }))
  }
}

function toggleAll() {
  if (allSelected.value) {
    store.clearSelection()
  } else {
    store.setSelection(filteredProducts.value.map((p) => p.productId))
  }
}

async function handleBatchAction(key: string) {
  const ids = Array.from(store.selected)
  if (ids.length === 0) return

  if (key === 'activate' || key === 'deactivate') {
    const active = key === 'activate'
    const confirmKey = active ? 'google.batch.confirmActivate' : 'google.batch.confirmDeactivate'
    const processingKey = active
      ? 'google.batch.processingActivate'
      : 'google.batch.processingDeactivate'
    const successKey = active ? 'google.batch.activateSuccess' : 'google.batch.deactivateSuccess'

    if (!confirm(t(confirmKey, { count: ids.length }))) return

    notify.info(t(processingKey))
    // IPC structuredClone bails on Vue's reactive proxies, so flatten before
    // sending. This is the same workaround the original code used.
    const plainProducts = JSON.parse(JSON.stringify(store.products))
    const result = await googleApi.batchUpdateStatus(props.projectId, ids, active, plainProducts)
    if (result.success) {
      const { data } = result
      if (data.failed.length > 0) {
        const details = data.failed
          .map((f: { id: string; error: string }) => `${f.id}: ${f.error}`)
          .join('\n')
        notify.error(t('google.batch.failedItems', { count: data.failed.length, details }))
      }
      if (data.success.length > 0) {
        notify.success(t(successKey, { count: data.success.length }))
      }
      store.clearSelection()
      await syncAll()
    } else {
      notify.error(result.error || t('google.batch.opFailed'))
    }
  }
}

function parsePriceToUnitsNanos(input: string): { units: string; nanos: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [intPart, fracPart = ''] = trimmed.split('.')
  const paddedFrac = (fracPart + '000000000').slice(0, 9)
  return { units: intPart, nanos: Number(paddedFrac) }
}

async function createProduct() {
  if (!newProduct.value.productId || !newProduct.value.name) {
    notify.error(t('google.toast.createFillRequired'))
    return
  }
  if (!/^[a-z0-9][a-z0-9._]*$/.test(newProduct.value.productId)) {
    notify.error(t('google.toast.createIdInvalid'))
    return
  }
  if (!newProduct.value.languageCode) {
    notify.error(t('google.toast.createNeedLanguage'))
    return
  }
  if (!newProduct.value.baseRegionCode) {
    notify.error(t('google.toast.createNeedRegion'))
    return
  }
  const baseCurrency = currencyForRegion(newProduct.value.baseRegionCode)
  if (!baseCurrency) {
    notify.error(t('google.toast.createNeedCurrency'))
    return
  }
  const parsed = parsePriceToUnitsNanos(newProduct.value.basePrice)
  if (!parsed) {
    notify.error(t('google.toast.createNeedPrice'))
    return
  }
  const poid = newProduct.value.purchaseOptionId.trim()
  if (!poid) {
    notify.error(t('google.toast.createNeedPoId'))
    return
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(poid)) {
    notify.error(t('google.toast.createPoIdInvalid'))
    return
  }

  creating.value = true
  const result = await googleApi.createProduct(props.projectId, {
    productId: newProduct.value.productId,
    name: newProduct.value.name,
    description: newProduct.value.description,
    languageCode: newProduct.value.languageCode,
    purchaseOptionId: poid,
    baseRegionCode: newProduct.value.baseRegionCode,
    baseCurrencyCode: baseCurrency,
    basePriceUnits: parsed.units,
    basePriceNanos: parsed.nanos
  })
  creating.value = false
  if (result.success) {
    const skipped = (result as { skippedRegions?: string[] }).skippedRegions
    if (skipped && skipped.length > 0) {
      notify.success(
        t('google.toast.createSuccessSkipped', {
          count: skipped.length,
          regions: skipped.join(', ')
        })
      )
    } else {
      notify.success(t('google.toast.createSuccess'))
    }
    showCreateForm.value = false
    newProduct.value = {
      productId: '',
      name: '',
      description: '',
      languageCode: projectDefaultLanguage.value,
      purchaseOptionId: 'base',
      baseRegionCode: '',
      basePrice: ''
    }
    await syncAll()
  } else {
    notify.error(result.error || t('google.toast.createFail'))
  }
}

function statusLabel(status: string): string {
  const key = `google.status.${status}`
  return te(key) ? t(key) : status
}

function productStatusLabel(product: GoogleProduct): string {
  const total = product.purchaseOptionCount ?? 0
  const active = product.activePurchaseOptionCount ?? 0
  // Only show the split when states are actually mixed; uniform states fall
  // back to the aggregated label to avoid noisy "0/2" or "2/2" displays.
  if (total > 1 && active > 0 && active < total) {
    return t('google.statusMixed', { active, total })
  }
  return statusLabel(product.status)
}

function productPriceLabel(product: GoogleProduct): string {
  if (!product.basePrice || !product.baseCurrency) return '-'
  return `${product.basePrice} ${product.baseCurrency}`
}

function statusColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-600/20 text-green-400'
    case 'INACTIVE':
    case 'INACTIVE_PUBLISHED':
      return 'bg-red-600/20 text-red-400'
    case 'DRAFT':
      return 'bg-yellow-600/20 text-yellow-400'
    default:
      return 'bg-divider text-gray-400'
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Toolbar -->
    <div class="mb-4 flex shrink-0 items-center justify-between px-6 pt-6">
      <div class="flex items-center gap-2">
        <button
          :disabled="store.syncing"
          class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          @click="syncAll"
        >
          {{ t('google.toolbar.sync') }}
        </button>
        <button
          :disabled="store.exporting || store.syncing || store.products.length === 0"
          class="border-divider-strong hover:bg-divider rounded-lg border px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors disabled:opacity-50"
          @click="exportProducts"
        >
          {{ t('google.toolbar.export') }}
        </button>
        <button
          :disabled="store.exporting || store.syncing"
          class="border-divider-strong hover:bg-divider rounded-lg border px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors disabled:opacity-50"
          @click="importProducts"
        >
          {{ t('google.toolbar.import') }}
        </button>
        <span v-if="store.syncing" class="flex items-center gap-2 text-sm text-gray-400">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-400 border-t-transparent"
          />
          {{ store.syncProgress }}
        </span>
        <span v-if="store.exporting" class="flex items-center gap-2 text-sm text-gray-400">
          <span
            class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-green-400 border-t-transparent"
          />
          {{ store.exportProgress }}
        </span>
        <span v-if="store.products.length > 0" class="text-sm whitespace-nowrap text-gray-500">
          {{
            filteredProducts.length !== store.products.length
              ? t('google.toolbar.productCountFiltered', {
                  filtered: filteredProducts.length,
                  total: store.products.length
                })
              : t('google.toolbar.productCount', { count: store.products.length })
          }}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <input
          v-model="searchQuery"
          type="text"
          class="border-divider-strong bg-deep w-52 rounded-lg border px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
          :placeholder="t('google.toolbar.searchPlaceholder')"
        />
        <button
          class="border-divider-strong hover:bg-divider rounded-lg border px-4 py-2 text-sm whitespace-nowrap text-gray-300 transition-colors"
          @click="openCreateForm"
        >
          {{ t('google.toolbar.create') }}
        </button>
      </div>
    </div>

    <!-- Batch Action Bar (inline) -->
    <div v-if="store.selected.size > 0" class="mb-3 flex shrink-0 items-center gap-3 px-6">
      <span class="text-sm whitespace-nowrap text-gray-300">
        {{ t('google.batch.selected', { count: store.selected.size }) }}
      </span>
      <div class="bg-divider-strong h-5 w-px" />
      <button
        v-for="action in batchActions"
        :key="action.key"
        class="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors"
        :class="
          action.variant === 'danger'
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-green-600 text-white hover:bg-green-700'
        "
        @click="handleBatchAction(action.key)"
      >
        {{ action.label }}
      </button>
      <button
        class="text-sm whitespace-nowrap text-gray-400 transition-colors hover:text-white"
        @click="store.clearSelection()"
      >
        {{ t('google.batch.clearSelection') }}
      </button>
    </div>

    <!-- Status filter chips -->
    <div v-if="statusGroups.length > 0" class="mb-4 flex shrink-0 flex-wrap gap-2 px-6">
      <button
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
        :class="
          activeFilter === null
            ? 'bg-green-600 text-white'
            : 'bg-card hover:bg-divider text-gray-400'
        "
        @click="setFilter(null)"
      >
        {{ t('google.filter.all', { count: store.products.length }) }}
      </button>
      <button
        v-for="group in statusGroups"
        :key="group.status"
        class="rounded-full px-3 py-1 text-xs font-medium transition-colors"
        :class="
          activeFilter === group.status
            ? 'bg-green-600 text-white'
            : 'bg-card hover:bg-divider text-gray-400'
        "
        @click="setFilter(group.status)"
      >
        {{ group.label }} {{ group.count }}
      </button>
    </div>

    <!-- Create Form Modal -->
    <div
      v-if="showCreateForm"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      @click.self="showCreateForm = false"
    >
      <div
        class="titlebar-no-drag border-divider bg-card flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border shadow-xl"
      >
        <div class="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h3 class="text-lg font-semibold text-gray-100">{{ t('google.create.title') }}</h3>
          <button
            class="hover:bg-divider rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:text-gray-300"
            @click="showCreateForm = false"
          >
            &times;
          </button>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">Product ID</label>
            <input
              v-model="newProduct.productId"
              type="text"
              maxlength="139"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
              :placeholder="t('google.create.productIdPlaceholder')"
            />
            <p class="mt-1 text-xs text-gray-500">{{ t('google.create.productIdHint') }}</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('google.create.languageLabel')
            }}</label>
            <div class="flex items-center gap-2">
              <div class="flex-1">
                <SearchableSelect
                  v-model="newProduct.languageCode"
                  :options="languageOptions"
                  :placeholder="t('google.create.languagePlaceholder')"
                />
              </div>
              <button
                :disabled="detectingLanguage"
                class="border-divider-strong hover:bg-divider rounded-lg border px-3 py-1.5 text-sm whitespace-nowrap text-gray-300 transition-colors disabled:opacity-50"
                @click="detectLanguageInModal"
              >
                {{ detectingLanguage ? t('google.create.detecting') : t('google.create.detect') }}
              </button>
            </div>
            <p class="mt-1 text-xs text-gray-500">{{ t('google.create.languageHint') }}</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('google.create.nameLabel')
            }}</label>
            <input
              v-model="newProduct.name"
              type="text"
              maxlength="55"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
              :placeholder="t('google.create.namePlaceholder')"
            />
            <p class="mt-1 text-right text-xs text-gray-500">{{ newProduct.name.length }} / 55</p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('google.create.descriptionLabel')
            }}</label>
            <textarea
              v-model="newProduct.description"
              maxlength="200"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
              rows="3"
              :placeholder="t('google.create.descriptionPlaceholder')"
            />
            <p class="mt-1 text-right text-xs text-gray-500">
              {{ newProduct.description.length }} / 200
            </p>
          </div>

          <div class="border-divider border-t pt-4">
            <div class="mb-3 text-xs text-gray-500">{{ t('google.create.poSection') }}</div>
            <div class="space-y-4">
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400">{{
                  t('google.create.poIdLabel')
                }}</label>
                <input
                  v-model="newProduct.purchaseOptionId"
                  type="text"
                  maxlength="63"
                  class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 font-mono text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
                  :placeholder="t('google.create.poIdPlaceholder')"
                />
                <p class="mt-1 text-xs text-gray-500">{{ t('google.create.poIdHint') }}</p>
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400">{{
                  t('google.create.purchaseTypeLabel')
                }}</label>
                <select
                  class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-green-500 focus:outline-none"
                >
                  <option value="BUY" selected>Buy</option>
                  <option value="RENT" disabled>{{ t('google.create.rentNotSupported') }}</option>
                </select>
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400">
                  {{ t('google.create.baseRegionLabel') }}
                  <span v-if="loadingRegions" class="ml-1 text-xs font-normal text-gray-500">{{
                    t('google.create.baseRegionLoading')
                  }}</span>
                </label>
                <SearchableSelect
                  v-model="newProduct.baseRegionCode"
                  :options="regionOptions"
                  :placeholder="t('google.create.baseRegionPlaceholder')"
                />
              </div>
              <div>
                <label class="mb-1 block text-sm font-medium text-gray-400">{{
                  t('google.create.basePriceLabel')
                }}</label>
                <div class="flex items-center gap-2">
                  <input
                    v-model="newProduct.basePrice"
                    type="text"
                    inputmode="decimal"
                    class="border-divider-strong bg-deep flex-1 rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:outline-none"
                    :placeholder="t('google.create.basePricePlaceholder')"
                  />
                  <span
                    class="border-divider-strong bg-table-head min-w-[4rem] rounded-lg border px-3 py-2 text-center text-sm text-gray-300"
                  >
                    {{ currencyForRegion(newProduct.baseRegionCode) || '---' }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-gray-500">{{ t('google.create.autoConvertHint') }}</p>
              </div>
            </div>
          </div>
        </div>
        <div class="border-divider flex shrink-0 justify-end gap-2 border-t px-6 py-4">
          <button
            :disabled="creating"
            class="hover:bg-divider rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors disabled:opacity-50"
            @click="showCreateForm = false"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            :disabled="creating"
            class="rounded-lg bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            @click="createProduct"
          >
            {{ creating ? t('google.create.creating') : t('common.create') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Product Table -->
    <div class="min-h-0 flex-1 px-6 pb-6">
      <div
        v-if="filteredProducts.length > 0"
        class="border-divider bg-card flex h-full flex-col overflow-hidden rounded-xl border"
      >
        <!-- Fixed header -->
        <div class="shrink-0" style="scrollbar-gutter: stable">
          <table class="w-full table-fixed">
            <colgroup>
              <col class="w-10" />
              <col class="w-[30%]" />
              <col class="w-[35%]" />
              <col class="w-[17%]" />
              <col class="w-[18%]" />
            </colgroup>
            <thead>
              <tr class="border-divider bg-table-head border-b">
                <th class="px-3 py-3">
                  <input
                    type="checkbox"
                    :checked="allSelected"
                    class="rounded"
                    @change="toggleAll"
                  />
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Product ID
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Product name
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Price
                </th>
                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
              </tr>
            </thead>
          </table>
        </div>
        <!-- Scrollable body -->
        <div class="min-h-0 flex-1 overflow-y-auto" style="scrollbar-gutter: stable">
          <table class="w-full table-fixed">
            <colgroup>
              <col class="w-10" />
              <col class="w-[30%]" />
              <col class="w-[35%]" />
              <col class="w-[17%]" />
              <col class="w-[18%]" />
            </colgroup>
            <tbody>
              <tr
                v-for="product in filteredProducts"
                :key="product.productId"
                class="border-divider hover:bg-row-hover cursor-pointer border-b transition-colors"
                :class="{ 'bg-green-600/10': store.selected.has(product.productId) }"
                @click="store.setSelectedProduct(product)"
              >
                <td class="w-10 px-3 py-3" @click.stop>
                  <input
                    type="checkbox"
                    :checked="store.selected.has(product.productId)"
                    class="rounded"
                    @change="store.toggleSelection(product.productId)"
                  />
                </td>
                <td class="px-3 py-3 font-mono text-sm text-gray-200">{{ product.productId }}</td>
                <td class="px-3 py-3 text-sm text-gray-300">{{ product.name }}</td>
                <td class="px-3 py-3 font-mono text-sm text-gray-300">
                  {{ productPriceLabel(product) }}
                </td>
                <td class="px-3 py-3">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs"
                    :class="statusColor(product.status)"
                  >
                    {{ productStatusLabel(product) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!store.loading && !store.syncing && store.products.length === 0"
        class="py-20 text-center"
      >
        <p class="mb-2 text-lg text-gray-500">{{ t('google.empty.noProducts') }}</p>
        <p class="text-sm text-gray-500">{{ t('google.empty.noProductsHint') }}</p>
      </div>
      <div
        v-else-if="!store.loading && !store.syncing && filteredProducts.length === 0"
        class="py-10 text-center"
      >
        <p class="text-sm text-gray-500">{{ t('google.empty.filteredEmpty') }}</p>
      </div>

      <div v-if="store.loading" class="py-20 text-center text-gray-500">
        {{ t('common.loading') }}
      </div>
    </div>

    <!-- Product Detail Modal -->
    <GoogleProductDetail
      v-if="store.selectedProduct"
      :project-id="projectId"
      @close="store.setSelectedProduct(null)"
    />

    <!-- Import Dialog -->
    <GoogleImportDialog
      v-if="importFileContent !== null"
      :project-id="projectId"
      :file-content="importFileContent"
      :existing-product-ids="existingProductIds"
      @close="importFileContent = null"
      @imported="onImportDone"
    />
  </div>
</template>
