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
  { key: 'apple' as const, label: 'Apple IAP' },
  { key: 'google' as const, label: 'Google 商品' },
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
  <div class="h-full flex flex-col">
    <!-- Header with drag region -->
    <div class="titlebar-drag bg-[#26272b] border-b border-[#393b40]">
      <div class="h-8" />
      <div class="px-6 pb-0">
        <h2 class="text-xl font-bold text-gray-100 mb-4 titlebar-no-drag">
          {{ store.currentProject?.name || '載入中...' }}
        </h2>
        <!-- Tabs -->
        <div class="flex gap-0">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            @click="activeTab = tab.key"
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors titlebar-no-drag"
            :class="activeTab === tab.key
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-y-auto p-6">
      <keep-alive :key="id">
        <AppleProductTable v-if="activeTab === 'apple'" :project-id="id" :key="'apple-' + id" />
        <GoogleProductTable v-else-if="activeTab === 'google'" :project-id="id" :key="'google-' + id" />
        <CredentialSettings v-else-if="activeTab === 'credentials'" :project-id="id" :key="'cred-' + id" />
      </keep-alive>
    </div>
  </div>
</template>
