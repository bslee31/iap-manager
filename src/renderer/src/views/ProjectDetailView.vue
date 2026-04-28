<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../stores/project.store'
import { useRouter } from 'vue-router'
import CredentialSettings from '../components/project/CredentialSettings.vue'
import AppleProductTable from '../components/apple/AppleProductTable.vue'
import GoogleProductTable from '../components/google/GoogleProductTable.vue'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const store = useProjectStore()
const router = useRouter()

const activeTab = ref<'apple' | 'google' | 'credentials'>('apple')

// Recompute on locale change so the labels update without a page reload.
const tabs = computed(() => [
  { key: 'apple' as const, label: t('project.tabs.apple') },
  { key: 'google' as const, label: t('project.tabs.google') },
  { key: 'credentials' as const, label: t('project.tabs.credentials') }
])

onMounted(async () => {
  if (!store.currentProject || store.currentProject.id !== props.id) {
    await store.fetchProjects()
    const project = store.projects.find((p) => p.id === props.id)
    if (project) {
      store.setCurrentProject(project)
    } else {
      router.replace('/')
    }
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header with drag region -->
    <div class="titlebar-drag border-b border-[#393b40] bg-[#26272b]">
      <div class="h-8" />
      <div class="px-6 pb-0">
        <h2 class="titlebar-no-drag mb-4 text-xl font-bold text-gray-100">
          {{ store.currentProject?.name || t('common.loading') }}
        </h2>
        <!-- Tabs -->
        <div class="flex gap-0">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="titlebar-no-drag border-b-2 px-4 py-2 text-sm font-medium transition-colors"
            :class="
              activeTab === tab.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            "
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Tab content -->
    <div v-if="activeTab === 'credentials'" class="min-h-0 flex-1 overflow-y-auto p-6">
      <CredentialSettings :key="'cred-' + id" :project-id="id" />
    </div>
    <div v-else-if="activeTab === 'apple'" class="flex min-h-0 flex-1 flex-col">
      <AppleProductTable :key="'apple-' + id" :project-id="id" />
    </div>
    <div v-else-if="activeTab === 'google'" class="flex min-h-0 flex-1 flex-col">
      <GoogleProductTable :key="'google-' + id" :project-id="id" />
    </div>
  </div>
</template>
