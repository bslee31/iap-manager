import { ipcMain } from 'electron'
import {
  findAllProjects,
  createProject,
  updateProject,
  deleteProject,
  reorderProjects
} from '../db/repositories/project.repo'
import { deleteCredentials } from '../services/credential-store'
import { clearTokenCache as clearAppleTokenCache } from '../services/apple/apple-auth'
import { clearGoogleAuthCache } from '../services/google/google-auth'
import { sanitizeError } from './sanitize-error'

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', async () => {
    try {
      const projects = findAllProjects()
      return projects.map((p) => ({
        ...p,
        has_apple: !!p.has_apple,
        has_google: !!p.has_google
      }))
    } catch (e) {
      console.error('project:list error', e)
      return []
    }
  })

  ipcMain.handle('project:create', async (_event, data: { name: string; description?: string }) => {
    try {
      const project = createProject(data)
      return { success: true, data: project }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'project:update',
    async (_event, id: string, data: { name?: string; description?: string }) => {
      try {
        const project = updateProject(id, data)
        if (!project) return { success: false, error: '專案不存在' }
        return { success: true, data: project }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('project:delete', async (_event, id: string) => {
    try {
      const deleted = deleteProject(id)
      if (deleted) {
        deleteCredentials(id)
        // Drop any cached auth tied to the deleted project so the next time
        // the same projectId is reused (or just to avoid stale state) we
        // don't leak credentials forward.
        clearAppleTokenCache(id)
        clearGoogleAuthCache(id)
      }
      if (!deleted) return { success: false, error: '專案不存在' }
      return { success: true }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('project:reorder', async (_event, orderedIds: string[]) => {
    try {
      reorderProjects(orderedIds)
      return { success: true }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })
}
