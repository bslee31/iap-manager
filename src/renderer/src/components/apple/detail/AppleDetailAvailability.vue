<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotificationStore } from '../../../stores/notification.store'
import { useAppleProductsStore } from '../../../stores/apple-products.store'
import {
  territoryName,
  groupTerritoriesByRegion,
  type GroupedTerritory
} from '../../../utils/territory-names'
import * as appleApi from '../../../services/api/apple'

const props = defineProps<{
  projectId: string
  iapId: string
  loading: boolean
  allTerritories: { id: string; currency: string }[]
}>()

const selectedTerritories = defineModel<Set<string>>('selectedTerritories', { required: true })
const availableInNewTerritories = defineModel<boolean>('availableInNew', { required: true })

const { t } = useI18n()
const notify = useNotificationStore()
const store = useAppleProductsStore()

const availSaving = ref(false)
const territorySearch = ref('')
const collapsedRegions = ref<Set<string>>(new Set())

const groupedTerritories = computed<GroupedTerritory[]>(() => {
  const codes = props.allTerritories.map((t) => t.id)
  const groups = groupTerritoriesByRegion(codes)
  if (!territorySearch.value.trim()) return groups
  const q = territorySearch.value.trim().toLowerCase()
  return groups
    .map((g) => ({
      ...g,
      territories: g.territories.filter(
        (t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)
      )
    }))
    .filter((g) => g.territories.length > 0)
})

function toggleRegion(regionName: string) {
  const s = new Set(collapsedRegions.value)
  if (s.has(regionName)) s.delete(regionName)
  else s.add(regionName)
  collapsedRegions.value = s
}

function regionSelectedCount(group: GroupedTerritory): number {
  return group.territories.filter((t) => selectedTerritories.value.has(t.code)).length
}

function toggleRegionAll(group: GroupedTerritory) {
  const s = new Set(selectedTerritories.value)
  const allSelected = group.territories.every((t) => s.has(t.code))
  for (const t of group.territories) {
    if (allSelected) s.delete(t.code)
    else s.add(t.code)
  }
  selectedTerritories.value = s
}

function toggleTerritory(id: string) {
  const s = new Set(selectedTerritories.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selectedTerritories.value = s
}

function selectAllTerritories() {
  selectedTerritories.value = new Set(props.allTerritories.map((t) => t.id))
}

function deselectAllTerritories() {
  selectedTerritories.value = new Set()
}

async function saveAvailability() {
  availSaving.value = true
  const result = await appleApi.updateAvailability(
    props.projectId,
    props.iapId,
    Array.from(selectedTerritories.value),
    availableInNewTerritories.value
  )
  availSaving.value = false
  if (result.success) {
    notify.success(t('apple.detail.availability.toast.updateSuccess'))
    store.updateProductTerritoryCount(selectedTerritories.value.size)
  } else {
    notify.error(result.error || t('apple.detail.availability.toast.updateFail'))
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="loading" class="py-10 text-center text-gray-500">{{ t('common.loading') }}</div>
    <template v-else>
      <!-- Top controls (fixed) -->
      <div class="shrink-0 px-6 pt-6 pb-2">
        <div class="mb-3 flex items-center justify-between">
          <h4 class="text-sm font-medium text-gray-200">
            {{ t('apple.detail.availability.title', { count: selectedTerritories.size }) }}
          </h4>
          <input
            v-model="territorySearch"
            type="text"
            class="border-divider-strong bg-deep w-40 rounded border px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            :placeholder="t('apple.detail.availability.searchPlaceholder')"
          />
        </div>

        <!-- Selected territories summary -->
        <div
          v-if="selectedTerritories.size > 0 && selectedTerritories.size <= 20"
          class="mb-3 flex flex-wrap gap-1"
        >
          <span
            v-for="code in [...selectedTerritories].sort((a, b) =>
              territoryName(a).localeCompare(territoryName(b))
            )"
            :key="code"
            class="inline-flex items-center gap-1 rounded-full bg-blue-600/15 px-2 py-0.5 text-xs text-blue-400"
          >
            {{ territoryName(code) }}
            <button class="hover:text-blue-200" @click="toggleTerritory(code)">&times;</button>
          </span>
        </div>
        <p v-else-if="selectedTerritories.size > 20" class="mb-3 text-xs text-gray-500">
          {{ t('apple.detail.availability.selectedHint', { count: selectedTerritories.size }) }}
        </p>

        <div class="flex items-center gap-1 text-xs">
          <span class="text-gray-500">Select</span>
          <button class="text-blue-400 underline hover:text-blue-300" @click="selectAllTerritories">
            All
          </button>
          <span class="text-gray-600">|</span>
          <button
            class="text-blue-400 underline hover:text-blue-300"
            @click="deselectAllTerritories"
          >
            None
          </button>
        </div>
        <!-- "Select All / None" kept in English to mirror Apple's own console UI. -->
      </div>

      <!-- Scrollable region list -->
      <div class="min-h-0 flex-1 space-y-1 overflow-y-auto px-6 py-2">
        <div v-for="group in groupedTerritories" :key="group.regionName">
          <button
            class="bg-deep hover:bg-sidebar-hover flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-200 transition-colors"
            @click="toggleRegion(group.regionName)"
          >
            <span
              class="text-[10px] text-gray-500 transition-transform"
              :class="{ '-rotate-90': collapsedRegions.has(group.regionName) }"
              >&#9660;</span
            >
            <span class="flex-1 text-left"
              >{{ group.regionName }} ({{ regionSelectedCount(group) }})</span
            >
            <span
              class="px-1 text-xs text-blue-400 hover:text-blue-300"
              @click.stop="toggleRegionAll(group)"
            >
              {{
                group.territories.every((tt) => selectedTerritories.has(tt.code))
                  ? t('apple.detail.availability.deselectAll')
                  : t('apple.detail.availability.selectAll')
              }}
            </span>
          </button>
          <div v-if="!collapsedRegions.has(group.regionName)" class="ml-3">
            <label
              v-for="terr in group.territories"
              :key="terr.code"
              class="hover:bg-row-hover flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors"
              :class="selectedTerritories.has(terr.code) ? 'text-gray-200' : 'text-gray-400'"
            >
              <input
                type="checkbox"
                :checked="selectedTerritories.has(terr.code)"
                class="h-3.5 w-3.5 rounded"
                @change="toggleTerritory(terr.code)"
              />
              {{ terr.name }}
            </label>
          </div>
        </div>
      </div>

      <!-- Footer (pinned at bottom) -->
      <div class="border-divider shrink-0 border-t px-6 py-4">
        <label class="mb-3 flex cursor-pointer items-center gap-2">
          <input v-model="availableInNewTerritories" type="checkbox" class="rounded" />
          <span class="text-sm text-gray-300">{{
            t('apple.detail.availability.newTerritoriesHint')
          }}</span>
        </label>
        <div class="flex justify-end">
          <button
            :disabled="availSaving"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            @click="saveAvailability"
          >
            {{ availSaving ? t('common.saving') : t('apple.detail.availability.saveButton') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
