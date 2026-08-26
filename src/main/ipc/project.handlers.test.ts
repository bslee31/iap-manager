import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capture what registerProjectHandlers() registers so each channel can be
// invoked directly, without Electron.
const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => handlers.set(channel, fn)
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

const repo = vi.hoisted(() => ({
  findAllProjects: vi.fn(() => []),
  findArchivedProjects: vi.fn(() => []),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(() => true),
  restoreProject: vi.fn(() => true),
  deleteProject: vi.fn(() => true),
  reorderProjects: vi.fn()
}))
vi.mock('../db/repositories/project.repo', () => repo)

const credentials = vi.hoisted(() => ({ deleteCredentials: vi.fn() }))
vi.mock('../services/credential-store', () => credentials)

const appleAuth = vi.hoisted(() => ({ clearTokenCache: vi.fn() }))
vi.mock('../services/apple/apple-auth', () => appleAuth)

const googleAuth = vi.hoisted(() => ({ clearGoogleAuthCache: vi.fn() }))
vi.mock('../services/google/google-auth', () => googleAuth)

import { registerProjectHandlers } from './project.handlers'

const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(null, ...args)

beforeEach(() => {
  handlers.clear()
  vi.clearAllMocks()
  repo.archiveProject.mockReturnValue(true)
  repo.restoreProject.mockReturnValue(true)
  repo.deleteProject.mockReturnValue(true)
  registerProjectHandlers()
})

describe('project:archive', () => {
  it('never touches the stored credentials', async () => {
    const result = await invoke('project:archive', 'p1')

    expect(result).toEqual({ success: true })
    expect(repo.archiveProject).toHaveBeenCalledWith('p1')
    // The whole point of archiving: restoring must not require re-issuing keys.
    expect(credentials.deleteCredentials).not.toHaveBeenCalled()
    expect(repo.deleteProject).not.toHaveBeenCalled()
  })

  it('drops the cached auth so nothing keeps calling Apple or Google', async () => {
    await invoke('project:archive', 'p1')

    expect(appleAuth.clearTokenCache).toHaveBeenCalledWith('p1')
    expect(googleAuth.clearGoogleAuthCache).toHaveBeenCalledWith('p1')
  })

  it('reports failure and leaves the caches alone when the row is already archived', async () => {
    repo.archiveProject.mockReturnValueOnce(false)

    const result = await invoke('project:archive', 'p1')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(appleAuth.clearTokenCache).not.toHaveBeenCalled()
  })
})

describe('project:restore', () => {
  it('restores without touching credentials', async () => {
    expect(await invoke('project:restore', 'p1')).toEqual({ success: true })
    expect(repo.restoreProject).toHaveBeenCalledWith('p1')
    expect(credentials.deleteCredentials).not.toHaveBeenCalled()
  })

  it('reports failure when the project is not archived', async () => {
    repo.restoreProject.mockReturnValueOnce(false)
    const result = await invoke('project:restore', 'p1')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('project:delete', () => {
  it('is the path that destroys the credentials', async () => {
    const result = await invoke('project:delete', 'p1')

    expect(result).toEqual({ success: true })
    expect(repo.deleteProject).toHaveBeenCalledWith('p1')
    expect(credentials.deleteCredentials).toHaveBeenCalledWith('p1')
    expect(appleAuth.clearTokenCache).toHaveBeenCalledWith('p1')
    expect(googleAuth.clearGoogleAuthCache).toHaveBeenCalledWith('p1')
  })

  it('leaves the credentials on disk when the row was not deleted', async () => {
    repo.deleteProject.mockReturnValueOnce(false)

    const result = await invoke('project:delete', 'p1')

    expect(result.success).toBe(false)
    expect(credentials.deleteCredentials).not.toHaveBeenCalled()
  })
})

describe('project:list-archived', () => {
  it('normalises the credential flags like the active list does', async () => {
    repo.findArchivedProjects.mockReturnValueOnce([
      { id: 'p1', name: 'Old', has_apple: 1, has_google: 0 }
    ] as never)

    const result = await invoke('project:list-archived')

    expect(result).toEqual([{ id: 'p1', name: 'Old', has_apple: true, has_google: false }])
  })
})
