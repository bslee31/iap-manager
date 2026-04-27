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
  <div class="mx-auto max-w-4xl p-8">
    <div class="titlebar-drag h-8" />

    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-2xl font-bold text-gray-100">專案列表</h2>
      <button
        class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
        @click="openCreateForm"
      >
        + 新增專案
      </button>
    </div>

    <!-- Project Form Modal -->
    <div v-if="showForm" class="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div class="w-full max-w-md rounded-xl border border-[#393b40] bg-[#2b2d30] p-6 shadow-xl">
        <h3 class="mb-4 text-lg font-semibold text-gray-100">
          {{ editingProject.id ? '編輯專案' : '新增專案' }}
        </h3>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">專案名稱</label>
            <input
              v-model="editingProject.name"
              type="text"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="例：我的 App"
              @keyup.enter="saveProject"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">專案描述</label>
            <textarea
              v-model="editingProject.description"
              class="w-full rounded-lg border border-[#43454a] bg-[#1e1f22] px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              rows="3"
              placeholder="選填"
            />
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button
            class="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-[#393b40]"
            @click="showForm = false"
          >
            取消
          </button>
          <button
            :disabled="!editingProject.name.trim()"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            @click="saveProject"
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
          class="group flex cursor-pointer items-center gap-3 rounded-lg border border-[#393b40] bg-[#2b2d30] px-4 py-3 transition-colors hover:border-[#43454a]"
          @click="goToProject(project)"
        >
          <span
            class="drag-handle shrink-0 cursor-grab text-gray-600 select-none hover:text-gray-400 active:cursor-grabbing"
            title="拖曳排序"
            @click.stop
            >&#9776;</span
          >
          <h3 class="min-w-0 flex-1 truncate font-semibold text-gray-100">{{ project.name }}</h3>
          <p
            v-if="project.description"
            class="hidden max-w-[200px] truncate text-sm text-gray-400 md:block"
          >
            {{ project.description }}
          </p>
          <div class="flex shrink-0 gap-1.5">
            <span
              class="rounded-full px-2 py-0.5 text-xs"
              :class="
                project.has_apple ? 'bg-blue-600/20 text-blue-400' : 'bg-[#393b40] text-gray-500'
              "
            >
              Apple
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-xs"
              :class="
                project.has_google ? 'bg-green-600/20 text-green-400' : 'bg-[#393b40] text-gray-500'
              "
            >
              Google
            </span>
          </div>
          <div class="flex shrink-0 gap-1" @click.stop>
            <button
              class="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-blue-600/15 hover:text-blue-400"
              title="編輯"
              @click="openEditForm(project)"
            >
              &#9998;
            </button>
            <button
              class="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-600/15 hover:text-red-400"
              title="刪除"
              @click="confirmDelete(project)"
            >
              &#10005;
            </button>
          </div>
        </div>
      </template>
    </draggable>

    <!-- Empty state -->
    <div v-else-if="!store.loading" class="py-20 text-center">
      <p class="mb-4 text-lg text-gray-500">尚未建立任何專案</p>
      <button
        class="rounded-lg bg-blue-600 px-6 py-2 text-sm text-white transition-colors hover:bg-blue-700"
        @click="openCreateForm"
      >
        建立第一個專案
      </button>
    </div>
  </div>
</template>
