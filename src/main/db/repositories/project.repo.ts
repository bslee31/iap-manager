import { getDatabase } from '../database'
import { v4 as uuidv4 } from 'uuid'

export interface ProjectRow {
  id: string
  name: string
  description: string | null
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
  has_apple: number
  has_google: number
}

// Archiving is a soft delete: the row and everything cascading off it stays,
// including the project's stored credentials. Only deleteProject() is
// destructive.

export function findAllProjects(): ProjectRow[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT p.*, COALESCE(c.has_apple, 0) as has_apple, COALESCE(c.has_google, 0) as has_google
       FROM projects p
       LEFT JOIN project_credentials c ON c.project_id = p.id
       WHERE p.archived_at IS NULL
       ORDER BY p.sort_order ASC`
    )
    .all() as ProjectRow[]
}

export function findArchivedProjects(): ProjectRow[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT p.*, COALESCE(c.has_apple, 0) as has_apple, COALESCE(c.has_google, 0) as has_google
       FROM projects p
       LEFT JOIN project_credentials c ON c.project_id = p.id
       WHERE p.archived_at IS NOT NULL
       ORDER BY p.archived_at DESC`
    )
    .all() as ProjectRow[]
}

// Unfiltered on purpose — the archive view needs to read archived projects.
export function findProjectById(id: string): ProjectRow | undefined {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT p.*, COALESCE(c.has_apple, 0) as has_apple, COALESCE(c.has_google, 0) as has_google
       FROM projects p
       LEFT JOIN project_credentials c ON c.project_id = p.id
       WHERE p.id = ?`
    )
    .get(id) as ProjectRow | undefined
}

export function createProject(data: { name: string; description?: string }): ProjectRow {
  const db = getDatabase()
  const id = uuidv4()
  const now = new Date().toISOString()

  // Scoped to active projects so sort_order stays compact. Ordering is relative,
  // so this is tidiness rather than behaviour — archived rows can't reorder the
  // list either way.
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM projects WHERE archived_at IS NULL'
    )
    .get() as any
  db.prepare(
    'INSERT INTO projects (id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, data.name, data.description || null, maxOrder.next, now, now)

  db.prepare('INSERT INTO project_credentials (project_id) VALUES (?)').run(id)

  return findProjectById(id)!
}

export function updateProject(
  id: string,
  data: { name?: string; description?: string }
): ProjectRow | undefined {
  const db = getDatabase()
  const project = findProjectById(id)
  if (!project) return undefined

  const name = data.name ?? project.name
  const description = data.description ?? project.description
  const now = new Date().toISOString()

  db.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
    name,
    description,
    now,
    id
  )

  return findProjectById(id)
}

export function archiveProject(id: string): boolean {
  const db = getDatabase()
  const now = new Date().toISOString()
  const result = db
    .prepare(
      'UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL'
    )
    .run(now, now, id)
  return result.changes > 0
}

export function restoreProject(id: string): boolean {
  const db = getDatabase()
  const now = new Date().toISOString()

  // Restore to the end of the active list rather than to the slot the project
  // used to hold: reorderProjects() rewrites the active projects to 0..n-1, so
  // a sort_order captured before archiving is stale and would collide.
  const next = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM projects WHERE archived_at IS NULL'
    )
    .get() as any

  const result = db
    .prepare(
      `UPDATE projects SET archived_at = NULL, sort_order = ?, updated_at = ?
       WHERE id = ? AND archived_at IS NOT NULL`
    )
    .run(next.next, now, id)
  return result.changes > 0
}

// Permanent: cascades to credentials/products rows. The caller is responsible
// for deleting the encrypted credential file, which lives outside the database.
export function deleteProject(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
}

export function reorderProjects(orderedIds: string[]): void {
  const db = getDatabase()
  const stmt = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?')
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      stmt.run(index, id)
    })
  })
  tx()
}
