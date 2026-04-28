import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Stub the project API module the store imports. vi.mock is hoisted above
// every `import` and runs before the test body, so the mocks have to be
// declared inside vi.hoisted to survive that hoist.
const projectApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn()
}))
vi.mock('../services/api/project', () => projectApi)

import { useProjectStore, type Project } from './project.store'

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
  })

  it('initial state is empty', () => {
    const store = useProjectStore()
    expect(store.projects).toEqual([])
    expect(store.currentProject).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('fetchProjects populates the list and toggles loading', async () => {
    const list = [makeProject({ id: 'a' }), makeProject({ id: 'b' })]
    projectApi.list.mockResolvedValueOnce(list)

    const store = useProjectStore()
    const promise = store.fetchProjects()
    expect(store.loading).toBe(true)
    await promise
    expect(store.projects).toEqual(list)
    expect(store.loading).toBe(false)
  })

  it('fetchProjects clears the loading flag even on rejection', async () => {
    projectApi.list.mockRejectedValueOnce(new Error('boom'))
    const store = useProjectStore()
    await expect(store.fetchProjects()).rejects.toThrow('boom')
    expect(store.loading).toBe(false)
  })

  it('createProject refetches on success and returns the api result', async () => {
    projectApi.create.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce([makeProject({ id: 'new' })])

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
    projectApi.list.mockResolvedValueOnce([after])

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
    projectApi.list.mockResolvedValueOnce([current, updated])

    const store = useProjectStore()
    store.setCurrentProject(current)
    await store.updateProject('p1', { name: 'New' })

    expect(store.currentProject).toEqual(current)
  })

  it('deleteProject clears currentProject when it matches', async () => {
    projectApi.remove.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce([])

    const store = useProjectStore()
    store.setCurrentProject(makeProject({ id: 'p1' }))
    await store.deleteProject('p1')

    expect(store.currentProject).toBeNull()
    expect(store.projects).toEqual([])
  })

  it('deleteProject leaves currentProject when a different project is deleted', async () => {
    const current = makeProject({ id: 'keep' })
    projectApi.remove.mockResolvedValueOnce({ success: true })
    projectApi.list.mockResolvedValueOnce([current])

    const store = useProjectStore()
    store.setCurrentProject(current)
    await store.deleteProject('other')

    expect(store.currentProject).toEqual(current)
  })

  it('reorderProjects rearranges the local array on success without refetching', async () => {
    const a = makeProject({ id: 'a' })
    const b = makeProject({ id: 'b' })
    const c = makeProject({ id: 'c' })
    projectApi.list.mockResolvedValueOnce([a, b, c])
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
    projectApi.list.mockResolvedValueOnce([a, b])
    projectApi.reorder.mockResolvedValueOnce({ success: true })

    const store = useProjectStore()
    await store.fetchProjects()
    await store.reorderProjects(['b', 'ghost', 'a'])

    expect(store.projects.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('reorderProjects skips local mutation on api failure', async () => {
    const a = makeProject({ id: 'a' })
    const b = makeProject({ id: 'b' })
    projectApi.list.mockResolvedValueOnce([a, b])
    projectApi.reorder.mockResolvedValueOnce({ success: false, error: 'no' })

    const store = useProjectStore()
    await store.fetchProjects()
    await store.reorderProjects(['b', 'a'])

    expect(store.projects.map((p) => p.id)).toEqual(['a', 'b'])
  })
})
