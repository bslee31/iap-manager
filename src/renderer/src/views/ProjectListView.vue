<script setup lang="ts">
import { useProjectStore } from '../stores/project.store'
import { useNotificationStore } from '../stores/notification.store'
import { useRouter } from 'vue-router'
import { ref, inject, watch, computed, type Ref } from 'vue'
import draggable from 'vuedraggable'

const store = useProjectStore()
const notify = useNotificationStore()
const router = useRouter()

const showForm = ref(false)

const createProjectTrigger = inject<Ref<number>>('createProjectTrigger')
if (createProjectTrigger) {
  watch(createProjectTrigger, () => {
    openCreateForm()
  })
}
const editingProject = ref<{ id?: string; name: string; description: string }>({
  name: '',
  description: ''
})

function openCreateForm() {
  editingProject.value = { name: '', description: '' }
  showForm.value = true
}

function openEditForm(project: (typeof store.projects)[0]) {
  editingProject.value = {
    id: project.id,
    name: project.name,
    description: project.description || ''
  }
  showForm.value = true
}

async function saveProject() {
  if (!editingProject.value.name.trim()) return

  if (editingProject.value.id) {
    const result = await store.updateProject(editingProject.value.id, {
      name: editingProject.value.name,
      description: editingProject.value.description
    })
    if (result.success) notify.success('專案已更新')
  } else {
    const result = await store.createProject({
      name: editingProject.value.name,
      description: editingProject.value.description
    })
    if (result.success) notify.success('專案已建立')
  }
  showForm.value = false
}

async function confirmDelete(project: (typeof store.projects)[0]) {
  if (!confirm(`確定要刪除「${project.name}」嗎？此操作無法復原。`)) return
  const result = await store.deleteProject(project.id)
  if (result.success) notify.success('專案已刪除')
}

function goToProject(project: (typeof store.projects)[0]) {
  store.setCurrentProject(project)
  router.push(`/projects/${project.id}`)
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
  <div class="p-8 max-w-4xl mx-auto">
    <div class="titlebar-drag h-8" />

    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-gray-100">專案列表</h2>
      <button
        @click="openCreateForm"
        class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
      >
        + 新增專案
      </button>
    </div>

    <!-- Project Form Modal -->
    <div v-if="showForm" class="fixed inset-0 bg-black/60 flex items-center justify-center z-40">
      <div class="bg-[#2b2d30] rounded-xl shadow-xl p-6 w-full max-w-md border border-[#393b40]">
        <h3 class="text-lg font-semibold mb-4 text-gray-100">
          {{ editingProject.id ? '編輯專案' : '新增專案' }}
        </h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">專案名稱</label>
            <input
              v-model="editingProject.name"
              type="text"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              placeholder="例：我的 App"
              @keyup.enter="saveProject"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-400 mb-1">專案描述</label>
            <textarea
              v-model="editingProject.description"
              class="w-full px-3 py-2 bg-[#1e1f22] border border-[#43454a] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              rows="3"
              placeholder="選填"
            />
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button
            @click="showForm = false"
            class="px-4 py-2 text-sm text-gray-400 hover:bg-[#393b40] rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            @click="saveProject"
            :disabled="!editingProject.name.trim()"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            儲存
          </button>
        </div>
      </div>
    </div>

    <!-- Project Cards -->
    <draggable
      v-if="store.projects.length > 0"
      v-model="draggableList"
      item-key="id"
      handle=".drag-handle"
      ghost-class="opacity-30"
      animation="200"
      class="flex flex-col gap-2"
      @end="onDragEnd"
    >
      <template #item="{ element: project }">
        <div
          class="bg-[#2b2d30] rounded-lg border border-[#393b40] px-4 py-3 hover:border-[#43454a] transition-colors cursor-pointer group flex items-center gap-3"
          @click="goToProject(project)"
        >
          <span
            class="drag-handle cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 select-none shrink-0"
            @click.stop
            title="拖曳排序"
          >&#9776;</span>
          <h3 class="font-semibold text-gray-100 truncate flex-1 min-w-0">{{ project.name }}</h3>
          <p v-if="project.description" class="text-sm text-gray-400 truncate max-w-[200px] hidden md:block">
            {{ project.description }}
          </p>
          <div class="flex gap-1.5 shrink-0">
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              :class="project.has_apple ? 'bg-blue-600/20 text-blue-400' : 'bg-[#393b40] text-gray-500'"
            >
              Apple
            </span>
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              :class="project.has_google ? 'bg-green-600/20 text-green-400' : 'bg-[#393b40] text-gray-500'"
            >
              Google
            </span>
          </div>
          <div class="flex gap-1 shrink-0" @click.stop>
            <button
              @click="openEditForm(project)"
              class="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-600/15 rounded-md transition-colors"
              title="編輯"
            >
              &#9998;
            </button>
            <button
              @click="confirmDelete(project)"
              class="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-600/15 rounded-md transition-colors"
              title="刪除"
            >
              &#10005;
            </button>
          </div>
        </div>
      </template>
    </draggable>

    <!-- Empty state -->
    <div v-else-if="!store.loading" class="text-center py-20">
      <p class="text-gray-500 text-lg mb-4">尚未建立任何專案</p>
      <button
        @click="openCreateForm"
        class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
      >
        建立第一個專案
      </button>
    </div>
  </div>
</template>
