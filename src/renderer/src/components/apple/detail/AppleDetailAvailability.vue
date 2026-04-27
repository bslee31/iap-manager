<script setup lang="ts">
import { ref, computed } from 'vue'
import { useNotificationStore } from '../../../stores/notification.store'
import {
  territoryName,
  groupTerritoriesByRegion,
  type GroupedTerritory
} from '../../../utils/territory-names'

const props = defineProps<{
  projectId: string
  iapId: string
  loading: boolean
  allTerritories: { id: string; currency: string }[]
}>()

const emit = defineEmits<{
  'update-availability': [count: number]
}>()

const selectedTerritories = defineModel<Set<string>>('selectedTerritories', { required: true })
const availableInNewTerritories = defineModel<boolean>('availableInNew', { required: true })

const notify = useNotificationStore()

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
  const result = await window.api.updateAppleAvailability(
    props.projectId,
    props.iapId,
    Array.from(selectedTerritories.value),
    availableInNewTerritories.value
  )
  availSaving.value = false
  if (result.success) {
    notify.success('Availability 已更新')
    emit('update-availability', selectedTerritories.value.size)
  } else {
    notify.error(result.error || '更新失敗')
  }
}
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div v-if="loading" class="text-center py-10 text-gray-500">載入中...</div>
    <template v-else>
      <!-- Top controls (fixed) -->
      <div class="px-6 pt-6 pb-2 shrink-0">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-sm font-medium text-gray-200">
            Country or Region Availability ({{ selectedTerritories.size }})
          </h4>
          <input
            v-model="territorySearch"
            type="text"
            class="px-2 py-1 bg-[#1e1f22] border border-[#43454a] rounded text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500 w-40"
            placeholder="搜尋地區..."
          />
        </div>

        <!-- Selected territories summary -->
        <div v-if="selectedTerritories.size > 0 && selectedTerritories.size <= 20" class="flex flex-wrap gap-1 mb-3">
          <span
            v-for="code in [...selectedTerritories].sort((a, b) => territoryName(a).localeCompare(territoryName(b)))"
            :key="code"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-600/15 text-blue-400"
          >
            {{ territoryName(code) }}
            <button @click="toggleTerritory(code)" class="hover:text-blue-200">&times;</button>
          </span>
        </div>
        <p v-else-if="selectedTerritories.size > 20" class="text-xs text-gray-500 mb-3">
          已選擇 {{ selectedTerritories.size }} 個地區
        </p>

        <div class="flex items-center gap-1 text-xs">
          <span class="text-gray-500">Select</span>
          <button @click="selectAllTerritories" class="text-blue-400 hover:text-blue-300 underline">All</button>
          <span class="text-gray-600">|</span>
          <button @click="deselectAllTerritories" class="text-blue-400 hover:text-blue-300 underline">None</button>
        </div>
      </div>

      <!-- Scrollable region list -->
      <div class="flex-1 min-h-0 overflow-y-auto px-6 py-2 space-y-1">
        <div v-for="group in groupedTerritories" :key="group.regionName">
          <button
            @click="toggleRegion(group.regionName)"
            class="w-full flex items-center gap-2 px-3 py-2 bg-[#1e1f22] rounded-lg text-sm font-medium text-gray-200 hover:bg-[#333538] transition-colors"
          >
            <span
              class="text-[10px] text-gray-500 transition-transform"
              :class="{ '-rotate-90': collapsedRegions.has(group.regionName) }"
            >&#9660;</span>
            <span class="flex-1 text-left">{{ group.regionName }} ({{ regionSelectedCount(group) }})</span>
            <span
              @click.stop="toggleRegionAll(group)"
              class="text-xs text-blue-400 hover:text-blue-300 px-1"
            >
              {{ group.territories.every(t => selectedTerritories.has(t.code)) ? 'Deselect All' : 'Select All' }}
            </span>
          </button>
          <div v-if="!collapsedRegions.has(group.regionName)" class="ml-3">
            <label
              v-for="t in group.territories"
              :key="t.code"
              class="flex items-center gap-2 px-3 py-1.5 rounded text-sm cursor-pointer transition-colors hover:bg-[#2e3038]"
              :class="selectedTerritories.has(t.code) ? 'text-gray-200' : 'text-gray-400'"
            >
              <input
                type="checkbox"
                :checked="selectedTerritories.has(t.code)"
                @change="toggleTerritory(t.code)"
                class="rounded w-3.5 h-3.5"
              />
              {{ t.name }}
            </label>
          </div>
        </div>
      </div>

      <!-- Footer (pinned at bottom) -->
      <div class="px-6 py-4 border-t border-[#393b40] shrink-0">
        <label class="flex items-center gap-2 cursor-pointer mb-3">
          <input type="checkbox" v-model="availableInNewTerritories" class="rounded" />
          <span class="text-sm text-gray-300">Make your in-app purchase automatically available in all future App Store countries or regions.</span>
        </label>
        <div class="flex justify-end">
          <button
            @click="saveAvailability"
            :disabled="availSaving"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {{ availSaving ? '儲存中...' : '儲存 Availability' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
