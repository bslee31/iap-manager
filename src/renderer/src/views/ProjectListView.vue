<script setup lang="ts">
import { useProjectStore } from '../stores/project.store'
import { useNotificationStore } from '../stores/notification.store'
import { useRouter } from 'vue-router'
import { ref, inject, watch, computed, onMounted, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'

const { t } = useI18n()
const store = useProjectStore()
const notify = useNotificationStore()
const router = useRouter()

const showForm = ref(false)
const showArchived = ref(false)

onMounted(() => {
  store.fetchArchivedProjects()
})

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
    if (result.success) notify.success(t('project.toast.updated'))
  } else {
    const result = await store.createProject({
      name: editingProject.value.name,
      description: editingProject.value.description
    })
    if (result.success) notify.success(t('project.toast.created'))
  }
  showForm.value = false
}

async function confirmArchive(project: (typeof store.projects)[0]) {
  if (!confirm(t('project.archiveConfirm', { name: project.name }))) return
  const result = await store.archiveProject(project.id)
  if (result.success) notify.success(t('project.toast.archived'))
  else notify.error(result.error || t('common.error'))
}

async function restore(project: (typeof store.archivedProjects)[0]) {
  const result = await store.restoreProject(project.id)
  if (result.success) notify.success(t('project.toast.restored'))
  else notify.error(result.error || t('common.error'))
}

// The only destructive path in the UI — it takes the credentials with it.
async function confirmDelete(project: (typeof store.archivedProjects)[0]) {
  if (!confirm(t('project.deleteConfirm', { name: project.name }))) return
  const result = await store.deleteProject(project.id)
  if (result.success) notify.success(t('project.toast.deleted'))
  else notify.error(result.error || t('common.error'))
}

function formatArchivedAt(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
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
      <h2 class="text-2xl font-bold text-gray-100">{{ t('project.list.title') }}</h2>
      <button
        class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
        @click="openCreateForm"
      >
        + {{ t('project.create') }}
      </button>
    </div>

    <!-- Project Form Modal -->
    <div v-if="showForm" class="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div class="border-divider bg-card w-full max-w-md rounded-xl border p-6 shadow-xl">
        <h3 class="mb-4 text-lg font-semibold text-gray-100">
          {{ editingProject.id ? t('project.edit') : t('project.create') }}
        </h3>
        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('project.form.name')
            }}</label>
            <input
              v-model="editingProject.name"
              type="text"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              :placeholder="t('project.form.namePlaceholder')"
              @keyup.enter="saveProject"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-gray-400">{{
              t('project.form.description')
            }}</label>
            <textarea
              v-model="editingProject.description"
              class="border-divider-strong bg-deep w-full rounded-lg border px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              rows="3"
              :placeholder="t('project.form.descPlaceholder')"
            />
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button
            class="hover:bg-divider rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors"
            @click="showForm = false"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            :disabled="!editingProject.name.trim()"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            @click="saveProject"
          >
            {{ t('common.save') }}
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
          class="group border-divider bg-card hover:border-divider-strong flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
          @click="goToProject(project)"
        >
          <span
            class="drag-handle shrink-0 cursor-grab text-gray-600 select-none hover:text-gray-400 active:cursor-grabbing"
            :title="t('project.list.dragHandle')"
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
                project.has_apple ? 'bg-blue-600/20 text-blue-400' : 'bg-divider text-gray-500'
              "
            >
              Apple
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-xs"
              :class="
                project.has_google ? 'bg-green-600/20 text-green-400' : 'bg-divider text-gray-500'
              "
            >
              Google
            </span>
          </div>
          <div class="flex shrink-0 gap-1" @click.stop>
            <button
              class="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-blue-600/15 hover:text-blue-400"
              :title="t('common.edit')"
              @click="openEditForm(project)"
            >
              &#9998;
            </button>
            <button
              class="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-amber-600/15 hover:text-amber-400"
              :title="t('project.archive.title')"
              @click="confirmArchive(project)"
            >
              &#8681;
            </button>
          </div>
        </div>
      </template>
    </draggable>

    <!-- Empty state -->
    <div v-else-if="!store.loading" class="py-20 text-center">
      <p class="mb-4 text-lg text-gray-500">{{ t('project.list.empty') }}</p>
      <!-- Without this the list looks like the data is gone rather than filed away. -->
      <p v-if="store.archivedProjects.length > 0" class="mb-4 text-sm text-gray-500">
        {{ t('project.archive.emptyHint', { count: store.archivedProjects.length }) }}
      </p>
      <button
        class="rounded-lg bg-blue-600 px-6 py-2 text-sm text-white transition-colors hover:bg-blue-700"
        @click="openCreateForm"
      >
        {{ t('project.list.firstProject') }}
      </button>
    </div>

    <!-- Archived -->
    <div v-if="store.archivedProjects.length > 0" class="border-divider mt-8 border-t pt-4">
      <button
        class="flex w-full items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-300"
        @click="showArchived = !showArchived"
      >
        <span class="text-xs">{{ showArchived ? '&#9662;' : '&#9656;' }}</span>
        {{ t('project.archive.title') }} ({{ store.archivedProjects.length }})
      </button>

      <div v-if="showArchived" class="mt-3 flex flex-col gap-2">
        <div
          v-for="project in store.archivedProjects"
          :key="project.id"
          class="border-divider bg-card/50 flex items-center gap-3 rounded-lg border px-4 py-2.5"
        >
          <h3 class="min-w-0 flex-1 truncate text-gray-400">{{ project.name }}</h3>
          <p class="shrink-0 text-xs text-gray-600">
            {{ t('project.archive.archivedAt', { date: formatArchivedAt(project.archived_at) }) }}
          </p>
          <div class="flex shrink-0 gap-1">
            <button
              class="rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-blue-600/15 hover:text-blue-400"
              @click="restore(project)"
            >
              {{ t('project.archive.restore') }}
            </button>
            <button
              class="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-red-600/15 hover:text-red-400"
              @click="confirmDelete(project)"
            >
              {{ t('project.archive.delete') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
