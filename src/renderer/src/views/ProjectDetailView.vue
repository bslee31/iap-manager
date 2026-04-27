<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useProjectStore } from '../stores/project.store'
import { useRouter } from 'vue-router'
import CredentialSettings from '../components/project/CredentialSettings.vue'
import AppleProductTable from '../components/apple/AppleProductTable.vue'
import GoogleProductTable from '../components/google/GoogleProductTable.vue'

const props = defineProps<{ id: string }>()
const store = useProjectStore()
const router = useRouter()

const activeTab = ref<'apple' | 'google' | 'credentials'>('apple')

const tabs = [
  { key: 'apple' as const, label: 'Apple In-App Purchases' },
  { key: 'google' as const, label: 'Google One-time products' },
  { key: 'credentials' as const, label: '憑證設定' }
]

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
          {{ store.currentProject?.name || '載入中...' }}
        </h2>
        <!-- Tabs -->
        <div class="flex gap-0">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            @click="activeTab = tab.key"
            class="titlebar-no-drag border-b-2 px-4 py-2 text-sm font-medium transition-colors"
            :class="
              activeTab === tab.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            "
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Tab content -->
    <div class="min-h-0 flex-1 overflow-y-auto p-6" v-if="activeTab === 'credentials'">
      <CredentialSettings :project-id="id" :key="'cred-' + id" />
    </div>
    <div class="flex min-h-0 flex-1 flex-col" v-else-if="activeTab === 'apple'">
      <AppleProductTable :project-id="id" :key="'apple-' + id" />
    </div>
    <div class="flex min-h-0 flex-1 flex-col" v-else-if="activeTab === 'google'">
      <GoogleProductTable :project-id="id" :key="'google-' + id" />
    </div>
  </div>
</template>
