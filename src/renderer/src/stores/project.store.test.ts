import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Stub the project API module the store imports. vi.mock is hoisted above
// every `import` and runs before the test body, so the mocks have to be
// declared inside vi.hoisted to survive that hoist.
const projectApi = vi.hoisted(() => ({
  list: vi.fn(),
  listArchived: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn()
}))
vi.mock('../services/api/project', () => projectApi)

import { useProjectStore, type Project } from './project.store'

// The list channels answer with the same { success, data } envelope as the
// mutating ones.
const ok = (data: Project[]) => ({ success: true, data })

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Project One',
    description: 'desc',
    created_at: '2026-04-28T00:00:00Z',
    updated_at: '2026-04-28T00:00:00Z',
    ...overrides
  }
}

describe('useProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(projectApi).forEach((fn) => fn.mockReset())
    // Every mutation refreshes the archive list too; individual tests override
    // this when they care about what comes back.
    projectApi.listArchived.mockResolvedValue(ok([]))
  })

  it('initial state is empty', () => {
    const store = useProjectStore()
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.loadError).toBeNull()
  })

  it('fetchProjects populates the list and toggles loading', async () => {
    const list = [makeProject({ id: 'a' }), makeProject({ id: 'b' })]
    projectApi.list.mockResolvedValueOnce(ok(list))

    const store = useProjectStore()
    const promise = store.fetchProjects()
    expect(store.loading).toBe(true)
    await promise
    expect(store.projects).toEqual(list)
    expect(store.loading).toBe(false)
  })

  it('fetchProjects surfaces a rejected call as a load error', async () => {
    projectApi.list.mockRejectedValueOnce(new Error('boom'))

    const store = useProjectStore()
    await store.fetchProjects()

    expect(store.loadError).toBe('boom')
    expect(store.loading).toBe(false)
  })

  it('fetchProjects keeps the current list when the call reports failure', async () => {
    const existing = makeProject({ id: 'a' })
    projectApi.list.mockResolvedValueOnce(ok([existing]))
    const store = useProjectStore()
    await store.fetchProjects()

    projectApi.list.mockResolvedValueOnce({ success: false, error: 'db is gone' })
    await store.fetchProjects()

    // Replacing the list with [] here would read as "you have no projects".
    expect(store.projects).toEqual([existing])
    expect(store.loadError).toBe('db is gone')
  })

  it('fetchProjects clears a previous load error on success', async () => {
    projectApi.list.mockResolvedValueOnce({ success: false, error: 'db is gone' })
    const store = useProjectStore()
    await store.fetchProjects()
    expect(store.loadError).toBe('db is gone')

    projectApi.list.mockResolvedValueOnce(ok([]))
    await store.fetchProjects()

    expect(store.loadError).toBeNull()
  })

  it('fetchArchivedProjects reports its own failure', async () => {
    projectApi.listArchived.mockResolvedValueOnce({ success: false, error: 'nope' })

    const store = useProjectStore()
    await store.fetchArchivedProjects()

    expect(store.loadError).toBe('nope')
    expect(store.archivedProjects).toEqual([])
  })

  it('createProject refetches on success and returns the api result', async () => {
    projectApi.create.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([makeProject({ id: 'new' })]))

    const store = useProjectStore()
    const result = await store.createProject({ name: 'New' })

    expect(result.success).toBe(true)
    expect(projectApi.list).toHaveBeenCalledOnce()
    expect(store.projects).toEqual([makeProject({ id: 'new' })])
  })

  it('createProject does not refetch on failure', async () => {
    projectApi.create.mockResolvedValueOnce({ success: false, error: 'nope' })
    const store = useProjectStore()
    await store.createProject({ name: 'X' })
    expect(projectApi.list).not.toHaveBeenCalled()
  })

  it('updateProject refetches and refreshes currentProject when it matches', async () => {
    const before = makeProject({ id: 'p1', name: 'Old' })
    const after = makeProject({ id: 'p1', name: 'New' })

    projectApi.update.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([after]))

    const store = useProjectStore()
    store.setCurrentProject(before)
    await store.updateProject('p1', { name: 'New' })

    expect(store.currentProject).toEqual(after)
    expect(store.projects).toEqual([after])
  })

  it('updateProject leaves currentProject untouched when ids differ', async () => {
    const current = makeProject({ id: 'other' })
    const updated = makeProject({ id: 'p1', name: 'New' })

    projectApi.update.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([current, updated]))

    const store = useProjectStore()
    store.setCurrentProject(current)
    await store.updateProject('p1', { name: 'New' })

    expect(store.currentProject).toEqual(current)
  })

  it('deleteProject clears currentProject when it matches', async () => {
    projectApi.remove.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([]))

    const store = useProjectStore()
    store.setCurrentProject(makeProject({ id: 'p1' }))
    await store.deleteProject('p1')

    expect(store.currentProject).toBeNull()
    expect(store.projects).toEqual([])
  })

  it('deleteProject leaves currentProject when a different project is deleted', async () => {
    const current = makeProject({ id: 'keep' })
    projectApi.remove.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([current]))

    const store = useProjectStore()
    store.setCurrentProject(current)
    await store.deleteProject('other')

    expect(store.currentProject).toEqual(current)
  })

  it('fetchArchivedProjects populates the archived list', async () => {
    const archived = [makeProject({ id: 'old', archived_at: '2026-08-01T00:00:00Z' })]
    projectApi.listArchived.mockResolvedValueOnce(ok(archived))

    const store = useProjectStore()
    await store.fetchArchivedProjects()

    expect(store.archivedProjects).toEqual(archived)
    expect(store.projects).toEqual([])
  })

  it('archiveProject moves the project between the two lists', async () => {
    const archived = makeProject({ id: 'p1', archived_at: '2026-08-26T00:00:00Z' })
    projectApi.archive.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([]))
    projectApi.listArchived.mockResolvedValueOnce(ok([archived]))

    const store = useProjectStore()
    await store.archiveProject('p1')

    expect(store.projects).toEqual([])
    expect(store.archivedProjects).toEqual([archived])
  })

  it('archiveProject clears currentProject when it matches', async () => {
    projectApi.archive.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([]))

    const store = useProjectStore()
    store.setCurrentProject(makeProject({ id: 'p1' }))
    await store.archiveProject('p1')

    expect(store.currentProject).toBeNull()
  })

  it('archiveProject leaves currentProject when a different project is archived', async () => {
    const current = makeProject({ id: 'keep' })
    projectApi.archive.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([current]))

    const store = useProjectStore()
    store.setCurrentProject(current)
    await store.archiveProject('other')

    expect(store.currentProject).toEqual(current)
  })

  it('archiveProject leaves both lists alone when the call fails', async () => {
    const current = makeProject({ id: 'p1' })
    projectApi.archive.mockResolvedValueOnce({ success: false, error: 'nope' })

    const store = useProjectStore()
    store.setCurrentProject(current)
    const result = await store.archiveProject('p1')

    expect(result.success).toBe(false)
    expect(projectApi.list).not.toHaveBeenCalled()
    expect(projectApi.listArchived).not.toHaveBeenCalled()
    expect(store.currentProject).toEqual(current)
  })

  it('restoreProject moves the project back into the active list', async () => {
    const restored = makeProject({ id: 'p1', archived_at: null })
    projectApi.restore.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([restored]))
    projectApi.listArchived.mockResolvedValueOnce(ok([]))

    const store = useProjectStore()
    // Seeded, so the assertion below fails if the archive list isn't refetched.
    store.archivedProjects = [makeProject({ id: 'p1', archived_at: '2026-08-26T00:00:00Z' })]
    await store.restoreProject('p1')

    expect(store.projects).toEqual([restored])
    expect(store.archivedProjects).toEqual([])
  })

  it('deleteProject drops the project from the archived list too', async () => {
    projectApi.remove.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce(ok([]))
    projectApi.listArchived.mockResolvedValueOnce(ok([]))

    const store = useProjectStore()
    store.archivedProjects = [makeProject({ id: 'p1', archived_at: '2026-08-26T00:00:00Z' })]
    await store.deleteProject('p1')

    expect(store.archivedProjects).toEqual([])
  })

  it('reorderProjects rearranges the local array on success without refetching', async () => {
    const a = makeProject({ id: 'a' })
    const b = makeProject({ id: 'b' })
    const c = makeProject({ id: 'c' })
    projectApi.list.mockResolvedValueOnce(ok([a, b, c]))
    projectApi.reorder.mockResolvedValueOnce({ success: true })

    const store = useProjectStore()
    await store.fetchProjects()
    projectApi.list.mockClear()

    await store.reorderProjects(['c', 'a', 'b'])

    expect(store.projects.map((p) => p.id)).toEqual(['c', 'a', 'b'])
    expect(projectApi.list).not.toHaveBeenCalled()
  })

  it('reorderProjects ignores ids that no longer exist locally', async () => {
    const a = makeProject({ id: 'a' })
    const b = makeProject({ id: 'b' })
    projectApi.list.mockResolvedValueOnce(ok([a, b]))
    projectApi.reorder.mockResolvedValueOnce({ success: true })

    const store = useProjectStore()
    await store.fetchProjects()
    await store.reorderProjects(['b', 'ghost', 'a'])

    expect(store.projects.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('reorderProjects skips local mutation on api failure', async () => {
    const a = makeProject({ id: 'a' })
    const b = makeProject({ id: 'b' })
    projectApi.list.mockResolvedValueOnce(ok([a, b]))
    projectApi.reorder.mockResolvedValueOnce({ success: false, error: 'no' })

    const store = useProjectStore()
    await store.fetchProjects()
    await store.reorderProjects(['b', 'a'])

    expect(store.projects.map((p) => p.id)).toEqual(['a', 'b'])
  })
})
