<script setup lang="ts">
import { useProjectStore } from '../../stores/project.store'
import { useRouter, useRoute } from 'vue-router'
import { onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'

const emit = defineEmits<{ 'create-project': [] }>()

const { t } = useI18n()
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

function startCreateProject() {
  router.push('/')
  emit('create-project')
}

const draggableList = computed({
  get: () => store.projects,
  set: (val) => {
    store.projects = val
  }
})

function onDragEnd() {
  const orderedIds = store.projects.map((p) => p.id)
  store.reorderProjects(orderedIds)
}
</script>

<template>
  <aside class="flex h-full w-60 flex-col border-r border-[#393b40] bg-[#26272b]/90 backdrop-blur">
    <!-- Title area with drag region -->
    <div class="titlebar-drag px-4 pt-8 pb-4">
      <h1
        class="titlebar-no-drag cursor-pointer text-base font-bold text-gray-200 transition-colors hover:text-white"
        @click="router.push('/')"
      >
        {{ t('app.title') }}
      </h1>
    </div>

    <!-- Project list -->
    <nav class="flex-1 overflow-y-auto px-2 py-2">
      <draggable
        v-model="draggableList"
        item-key="id"
        ghost-class="opacity-30"
        animation="200"
        @end="onDragEnd"
      >
        <template #item="{ element: project }">
          <button
            class="mb-0.5 w-full cursor-grab rounded-lg px-3 py-2 text-left text-sm transition-colors active:cursor-grabbing"
            :class="
              isActive(project.id)
                ? 'bg-blue-600/20 font-medium text-blue-400'
                : 'text-gray-300 hover:bg-[#393b40]'
            "
            @click="selectProject(project)"
          >
            {{ project.name }}
          </button>
        </template>
      </draggable>

      <p
        v-if="store.projects.length === 0 && !store.loading"
        class="px-3 py-4 text-center text-xs text-gray-500"
      >
        {{ t('project.list.empty') }}
      </p>
    </nav>

    <!-- Bottom actions -->
    <div class="space-y-1 border-t border-[#393b40] p-2">
      <button
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-blue-400 transition-colors hover:bg-blue-600/15"
        @click="startCreateProject"
      >
        <span class="text-lg leading-none">+</span>
        {{ t('sidebar.newProject') }}
      </button>
      <button
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-[#393b40]"
        @click="router.push('/settings')"
      >
        <span class="text-base leading-none">&#9881;</span>
        {{ t('sidebar.settings') }}
      </button>
    </div>
  </aside>
</template>
