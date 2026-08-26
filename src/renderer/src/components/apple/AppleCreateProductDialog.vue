<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../stores/notification.store'
import SearchableSelect from '../common/SearchableSelect.vue'
import { APPLE_LOCALES } from '../../utils/apple-locales'
import { territoryName } from '../../utils/territory-names'
import * as appleApi from '../../services/api/apple'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ close: []; created: [] }>()

const { t } = useI18n()
const notify = useNotificationStore()

// Apple only lists a product's allowed price points under the product itself
// (GET /v2/inAppPurchases/{id}/pricePoints), so there is no way to offer real
// prices before the product exists. Hence two steps: create, then configure.
const step = ref<'basics' | 'details'>('basics')
const creating = ref(false)
const saving = ref(false)
const createdIapId = ref('')

const basics = ref({ productId: '', referenceName: '', inAppPurchaseType: 'CONSUMABLE' })
const localization = ref({ locale: 'en-US', name: '', description: '' })
const price = ref({ territory: 'USA', pricePointId: '' })

const allTerritories = ref<{ id: string; currency: string }[]>([])
const pricePoints = ref<{ id: string; customerPrice: string; proceeds: string }[]>([])
const pricePointsLoading = ref(false)

const localeOptions = computed(() => APPLE_LOCALES.map((l) => ({ value: l.value, label: l.label })))

const territoryOptions = computed(() =>
  allTerritories.value
    .map((terr) => ({ value: terr.id, label: `${territoryName(terr.id)} (${terr.currency})` }))
    .sort((a, b) => a.label.localeCompare(b.label))
)

const pricePointOptions = computed(() =>
  pricePoints.value.map((pp) => ({
    value: pp.id,
    label: pp.customerPrice,
    right: `${t('apple.detail.price.proceedsLabel')}: ${pp.proceeds}`
  }))
)

async function createBasics() {
  if (!basics.value.productId || !basics.value.referenceName) {
    notify.error(t('apple.toast.createFillRequired'))
    return
  }

  creating.value = true
  const result = await appleApi.createProduct(props.projectId, {
    ...basics.value,
    appId: '' // Filled from credentials in the main process
  })
  creating.value = false

  if (!result.success) {
    notify.error(result.error || t('apple.toast.createFail'))
    return
  }

  createdIapId.value = result.data.id
  notify.success(t('apple.toast.createSuccess'))
  step.value = 'details'

  const [localeResult, territoryResult] = await Promise.all([
    appleApi.getPrimaryLocale(props.projectId),
    appleApi.getAllTerritories(props.projectId)
  ])
  if (localeResult.success) localization.value.locale = localeResult.data
  if (territoryResult.success) allTerritories.value = territoryResult.data
  await loadPricePoints()
}

async function loadPricePoints() {
  if (!createdIapId.value || !price.value.territory) return
  pricePointsLoading.value = true
  price.value.pricePointId = ''
  const result = await appleApi.getPricePoints(
    props.projectId,
    createdIapId.value,
    price.value.territory
  )
  if (result.success) {
    pricePoints.value = result.data
  } else {
    notify.error(result.error || t('apple.create.pricePointsFail'))
  }
  pricePointsLoading.value = false
}

watch(() => price.value.territory, loadPricePoints)

// Both steps are independent Apple calls, so report them separately: a product
// that got its price but not its localization is a real state the user needs to
// know about, not a blanket failure.
async function saveDetails() {
  saving.value = true
  const failures: string[] = []

  if (localization.value.name) {
    const result = await appleApi.createLocalization(props.projectId, createdIapId.value, {
      locale: localization.value.locale,
      name: localization.value.name,
      description: localization.value.description
    })
    if (!result.success) {
      failures.push(`${t('apple.create.stepLocalization')}: ${result.error}`)
    }
  }

  if (price.value.pricePointId) {
    const result = await appleApi.setPriceSchedule(
      props.projectId,
      createdIapId.value,
      price.value.territory,
      price.value.pricePointId
    )
    if (!result.success) {
      failures.push(`${t('apple.create.stepPrice')}: ${result.error}`)
    }
  }

  saving.value = false

  if (failures.length > 0) {
    // Keep the dialog open so the user can retry the part that failed — the
    // product already exists, so closing would strand it half-configured.
    notify.error(t('apple.create.partialFail', { details: failures.join('\n') }))
    return
  }

  notify.success(t('apple.create.configured'))
  emit('created')
}

// The product is already created by the time step 2 is on screen, so closing
// isn't a cancel — the list still has to refresh.
function close() {
  if (creating.value || saving.value) return
  if (createdIapId.value) emit('created')
  else emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60" @click.self="close">
    <div
      class="titlebar-no-drag border-divider bg-card max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border p-6 shadow-xl"
    >
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-gray-100">
          {{ step === 'basics' ? t('apple.create.title') : t('apple.create.detailsTitle') }}
        </h3>
        <button
          class="hover:bg-divider rounded p-2 text-xl leading-none text-gray-500 transition-colors hover:text-gray-300"
          @click="close"
        >
          &times;
        </button>
      </div>

      <!-- Step 1 -->
      <template v-if="step === 'basics'">
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">Product ID</label>
            <input
              v-model="basics.productId"
              type="text"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              :placeholder="t('apple.create.productIdPlaceholder')"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">Reference Name</label>
            <input
              v-model="basics.referenceName"
              type="text"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              :placeholder="t('apple.create.refNamePlaceholder')"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('apple.create.typeLabel')
            }}</label>
            <select
              v-model="basics.inAppPurchaseType"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="CONSUMABLE">{{ t('apple.type.CONSUMABLE') }}</option>
              <option value="NON_CONSUMABLE">{{ t('apple.type.NON_CONSUMABLE') }}</option>
            </select>
          </div>
          <p class="text-xs text-gray-500">{{ t('apple.create.createsNowHint') }}</p>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <button
            class="hover:bg-divider rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors"
            @click="close"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            :disabled="creating"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            @click="createBasics"
          >
            {{ creating ? t('apple.create.creating') : t('apple.create.createAndContinue') }}
          </button>
        </div>
      </template>

      <!-- Step 2 -->
      <template v-else>
        <p class="mb-4 text-xs text-gray-500">
          {{ t('apple.create.detailsHint', { productId: basics.productId }) }}
        </p>

        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('apple.create.localeLabel')
            }}</label>
            <SearchableSelect v-model="localization.locale" :options="localeOptions" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('apple.create.displayNameLabel')
            }}</label>
            <input
              v-model="localization.name"
              type="text"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              :placeholder="t('apple.detail.localization.namePlaceholder')"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('apple.create.descriptionLabel')
            }}</label>
            <textarea
              v-model="localization.description"
              rows="2"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              :placeholder="t('apple.detail.localization.descPlaceholder')"
            />
          </div>

          <div class="border-divider border-t pt-4">
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('apple.create.baseTerritoryLabel')
            }}</label>
            <SearchableSelect v-model="price.territory" :options="territoryOptions" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('apple.create.basePriceLabel')
            }}</label>
            <p v-if="pricePointsLoading" class="text-sm text-gray-500">{{ t('common.loading') }}</p>
            <SearchableSelect
              v-else
              v-model="price.pricePointId"
              :options="pricePointOptions"
              :placeholder="t('apple.create.pricePlaceholder')"
            />
            <p class="mt-1 text-xs text-gray-500">{{ t('apple.create.priceHint') }}</p>
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <button
            class="hover:bg-divider rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors"
            @click="close"
          >
            {{ t('apple.create.skip') }}
          </button>
          <button
            :disabled="saving"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            @click="saveDetails"
          >
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
