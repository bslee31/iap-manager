import { getDatabase } from '../database'

export function getGoogleDefaultLanguage(projectId: string): string | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT google_default_language FROM project_credentials WHERE project_id = ?')
    .get(projectId) as { google_default_language: string | null } | undefined
  return row?.google_default_language ?? null
}

export function setGoogleDefaultLanguage(projectId: string, languageCode: string | null): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE project_credentials SET google_default_language = ? WHERE project_id = ?'
  ).run(languageCode, projectId)
}

export function getGoogleBaseRegion(projectId: string): string | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT google_base_region FROM project_credentials WHERE project_id = ?')
    .get(projectId) as { google_base_region: string | null } | undefined
  return row?.google_base_region ?? null
}

export function setGoogleBaseRegion(projectId: string, regionCode: string | null): void {
  const db = getDatabase()
  db.prepare(
    'UPDATE project_credentials SET google_base_region = ? WHERE project_id = ?'
  ).run(regionCode, projectId)
}
