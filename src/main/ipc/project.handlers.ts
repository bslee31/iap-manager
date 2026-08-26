import { ipcMain } from 'electron'
import {
  findAllProjects,
  findArchivedProjects,
  createProject,
  updateProject,
  archiveProject,
  restoreProject,
  deleteProject,
  reorderProjects,
  type ProjectRow
} from '../db/repositories/project.repo'
import { deleteCredentials } from '../services/credential-store'
import { clearTokenCache as clearAppleTokenCache } from '../services/apple/apple-auth'
import { clearGoogleAuthCache } from '../services/google/google-auth'
import { sanitizeError } from './sanitize-error'
import { t } from '../i18n'

// SQLite has no booleans; the renderer wants them.
function toProjectDto(p: ProjectRow): Record<string, unknown> {
  return { ...p, has_apple: !!p.has_apple, has_google: !!p.has_google }
}

export function registerProjectHandlers(): void {
  // Both list channels use the same { success, data } envelope as the mutating
  // ones: swallowing a failure into an empty array reads as "you have no
  // projects", which is indistinguishable from real data loss.
  ipcMain.handle('project:list', async () => {
    try {
      return { success: true, data: findAllProjects().map(toProjectDto) }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
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
        if (!project) return { success: false, error: t('project.notFound') }
        return { success: true, data: project }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('project:list-archived', async () => {
    try {
      return { success: true, data: findArchivedProjects().map(toProjectDto) }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  // Archiving keeps everything on disk, credentials included, so restoring is
  // lossless. Only the cached auth is dropped, since nothing should be talking
  // to Apple or Google on behalf of an archived project.
  ipcMain.handle('project:archive', async (_event, id: string) => {
    try {
      if (!archiveProject(id)) return { success: false, error: t('project.archiveFailed') }
      clearAppleTokenCache(id)
      clearGoogleAuthCache(id)
      return { success: true }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('project:restore', async (_event, id: string) => {
    try {
      if (!restoreProject(id)) return { success: false, error: t('project.restoreFailed') }
      return { success: true }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  // Permanent, and the only path that destroys the stored credentials.
  ipcMain.handle('project:delete', async (_event, id: string) => {
    try {
      const deleted = deleteProject(id)
      if (!deleted) return { success: false, error: t('project.notFound') }

      deleteCredentials(id)
      // Drop any cached auth tied to the deleted project so the next time
      // the same projectId is reused (or just to avoid stale state) we
      // don't leak credentials forward.
      clearAppleTokenCache(id)
      clearGoogleAuthCache(id)
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
