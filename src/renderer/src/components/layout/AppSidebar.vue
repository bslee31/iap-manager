<script setup lang="ts">
import { useProjectStore } from '../../stores/project.store'
import { useRouter, useRoute } from 'vue-router'
import { onMounted } from 'vue'

const emit = defineEmits<{ 'create-project': [] }>()

const store = useProjectStore()
const router = useRouter()
const route = useRoute()

onMounted(() => {
  store.fetchProjects()
})

function selectProject(project: (typeof store.projects)[0]) {
  store.setCurrentProject(project)
  router.push(`/projects/${project.id}`)
}

function isActive(projectId: string) {
  return route.params.id === projectId
}
</script>

<template>
  <aside class="w-60 bg-[#26272b]/90 backdrop-blur border-r border-[#393b40] flex flex-col h-full">
    <!-- Title area with drag region -->
    <div class="titlebar-drag pt-8 pb-4 px-4">
      <h1
        @click="router.push('/')"
        class="text-base font-bold text-gray-200 titlebar-no-drag cursor-pointer hover:text-white transition-colors"
      >
        IAP 管理工具
      </h1>
    </div>

    <!-- Project list -->
    <nav class="flex-1 overflow-y-auto px-2 py-2">
      <button
        v-for="project in store.projects"
        :key="project.id"
        @click="selectProject(project)"
        class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors mb-0.5"
        :class="isActive(project.id)
          ? 'bg-blue-600/20 text-blue-400 font-medium'
          : 'text-gray-300 hover:bg-[#393b40]'"
      >
        {{ project.name }}
      </button>

      <p v-if="store.projects.length === 0 && !store.loading" class="text-xs text-gray-500 px-3 py-4 text-center">
        尚未建立任何專案
      </p>
    </nav>

    <!-- Bottom actions -->
    <div class="p-2 border-t border-[#393b40] space-y-1">
      <button
        @click="router.push('/'); emit('create-project')"
        class="w-full text-left px-3 py-2 rounded-lg text-sm text-blue-400 hover:bg-blue-600/15 transition-colors flex items-center gap-2"
      >
        <span class="text-lg leading-none">+</span>
        新增專案
      </button>
      <button
        @click="router.push('/settings')"
        class="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-[#393b40] transition-colors flex items-center gap-2"
      >
        <span class="text-base leading-none">&#9881;</span>
        設定
      </button>
    </div>
  </aside>
</template>
