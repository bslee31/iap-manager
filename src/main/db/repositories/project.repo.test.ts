// @vitest-environment node
// The default happy-dom environment can't resolve Node built-ins, and this
// suite needs node:sqlite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// better-sqlite3 ships a native binding built against Electron's ABI, so it
// can't load in the test runner's Node process. node:sqlite is the same engine
// with a near-identical API; this shim covers the surface database.ts uses so
// the real migrations and the real repository SQL are what get exercised.
vi.mock('better-sqlite3', async () => {
  const { DatabaseSync } = await import('node:sqlite')

  class SqliteShim {
    private db: InstanceType<typeof DatabaseSync>
    constructor(path: string) {
      this.db = new DatabaseSync(path)
    }
    pragma(statement: string): void {
      this.db.exec(`PRAGMA ${statement}`)
    }
    exec(sql: string): void {
      this.db.exec(sql)
    }
    prepare(sql: string): unknown {
      return this.db.prepare(sql)
    }
    transaction<T extends (...args: any[]) => any>(fn: T): T {
      return ((...args: Parameters<T>) => {
        this.db.exec('BEGIN')
        try {
          const result = fn(...args)
          this.db.exec('COMMIT')
          return result
        } catch (e) {
          this.db.exec('ROLLBACK')
          throw e
        }
      }) as T
    }
    close(): void {
      this.db.close()
    }
  }

  return { default: SqliteShim }
})

// Hoisted so the electron mock factory can read it after each test picks a
// fresh temp directory.
const state = vi.hoisted(() => ({ dataDir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.dataDir } }))

import { getDatabase, closeDatabase } from '../database'
import {
  createProject,
  findAllProjects,
  findArchivedProjects,
  findProjectById,
  archiveProject,
  restoreProject,
  deleteProject,
  reorderProjects
} from './project.repo'

const names = (rows: { name: string }[]): string[] => rows.map((r) => r.name)

beforeEach(() => {
  state.dataDir = mkdtempSync(join(tmpdir(), 'iap-repo-test-'))
})

afterEach(() => {
  closeDatabase()
  rmSync(state.dataDir, { recursive: true, force: true })
})

describe('migrations', () => {
  it('adds archived_at to projects', () => {
    const columns = getDatabase().prepare('PRAGMA table_info(projects)').all() as { name: string }[]
    expect(names(columns)).toContain('archived_at')
  })
})

describe('archiveProject', () => {
  it('hides the project from the active list without deleting anything', () => {
    const keep = createProject({ name: 'Keep' })
    const gone = createProject({ name: 'Gone' })

    expect(archiveProject(gone.id)).toBe(true)

    expect(names(findAllProjects())).toEqual(['Keep'])
    expect(names(findArchivedProjects())).toEqual(['Gone'])
    // The row and its cascading credentials row survive — this is a soft delete.
    expect(findProjectById(gone.id)?.archived_at).toBeTruthy()
    const creds = getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM project_credentials WHERE project_id = ?')
      .get(gone.id) as { n: number }
    expect(creds.n).toBe(1)
    expect(keep.id).not.toBe(gone.id)
  })

  it('is a no-op on an already archived project', () => {
    const project = createProject({ name: 'Once' })
    expect(archiveProject(project.id)).toBe(true)
    expect(archiveProject(project.id)).toBe(false)
  })

  it('reports failure for an unknown id', () => {
    expect(archiveProject('nope')).toBe(false)
  })
})

describe('restoreProject', () => {
  it('brings the project back at the end of the active order', () => {
    const first = createProject({ name: 'First' })
    const second = createProject({ name: 'Second' })
    const third = createProject({ name: 'Third' })

    archiveProject(first.id)
    // Reordering while it was archived rewrites the survivors to 0..n-1, so the
    // slot the archived project used to hold no longer belongs to it.
    reorderProjects([third.id, second.id])

    expect(restoreProject(first.id)).toBe(true)
    expect(names(findAllProjects())).toEqual(['Third', 'Second', 'First'])
    expect(findProjectById(first.id)?.archived_at).toBeNull()
    expect(findArchivedProjects()).toHaveLength(0)
  })

  it('is a no-op on a project that is not archived', () => {
    const project = createProject({ name: 'Active' })
    expect(restoreProject(project.id)).toBe(false)
  })
})

describe('deleteProject', () => {
  it('permanently removes the project and its cascading rows', () => {
    const project = createProject({ name: 'Doomed' })
    archiveProject(project.id)

    expect(deleteProject(project.id)).toBe(true)

    expect(findProjectById(project.id)).toBeUndefined()
    expect(findArchivedProjects()).toHaveLength(0)
    const creds = getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM project_credentials WHERE project_id = ?')
      .get(project.id) as { n: number }
    expect(creds.n).toBe(0)
  })
})

describe('data directory', () => {
  it('keeps the database inside the app data dir', () => {
    getDatabase()
    expect(existsSync(join(state.dataDir, '.iap-manager', 'data.db'))).toBe(true)
  })
})
