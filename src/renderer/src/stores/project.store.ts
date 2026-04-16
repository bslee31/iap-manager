import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Project {
  id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
  has_apple?: boolean
  has_google?: boolean
}

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([])
  const currentProject = ref<Project | null>(null)
  const loading = ref(false)

  async function fetchProjects() {
    loading.value = true
    try {
      projects.value = await window.api.listProjects()
    } finally {
      loading.value = false
    }
  }

  async function createProject(data: { name: string; description?: string }) {
    const result = await window.api.createProject(data)
    if (result.success) {
      await fetchProjects()
    }
    return result
  }

  async function updateProject(id: string, data: { name?: string; description?: string }) {
    const result = await window.api.updateProject(id, data)
    if (result.success) {
      await fetchProjects()
      if (currentProject.value?.id === id) {
        currentProject.value = projects.value.find((p) => p.id === id) || null
      }
    }
    return result
  }

  async function deleteProject(id: string) {
    const result = await window.api.deleteProject(id)
    if (result.success) {
      await fetchProjects()
      if (currentProject.value?.id === id) {
        currentProject.value = null
      }
    }
    return result
  }

  async function reorderProjects(orderedIds: string[]) {
    const result = await window.api.reorderProjects(orderedIds)
    if (result.success) {
      // Reorder local array to match
      const idToProject = new Map(projects.value.map((p) => [p.id, p]))
      projects.value = orderedIds.map((id) => idToProject.get(id)!).filter(Boolean)
    }
    return result
  }

  function setCurrentProject(project: Project | null) {
    currentProject.value = project
  }

  return {
    projects,
    currentProject,
    loading,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    reorderProjects,
    setCurrentProject
  }
})
