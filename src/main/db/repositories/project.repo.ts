import { getDatabase } from '../database'
import { v4 as uuidv4 } from 'uuid'

export interface ProjectRow {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  has_apple: number
  has_google: number
}

export function findAllProjects(): ProjectRow[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT p.*, COALESCE(c.has_apple, 0) as has_apple, COALESCE(c.has_google, 0) as has_google
       FROM projects p
       LEFT JOIN project_credentials c ON c.project_id = p.id
       ORDER BY p.updated_at DESC`
    )
    .all() as ProjectRow[]
}

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

export function createProject(data: {
  name: string
  description?: string
}): ProjectRow {
  const db = getDatabase()
  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(
    'INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, data.name, data.description || null, now, now)

  db.prepare(
    'INSERT INTO project_credentials (project_id) VALUES (?)'
  ).run(id)

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

  db.prepare(
    'UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?'
  ).run(name, description, now, id)

  return findProjectById(id)
}

export function deleteProject(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
}
