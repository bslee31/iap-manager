import { googleRequest } from './google-auth'

/**
 * Detect the app's default language via the Edits API.
 * Flow: POST /edits → GET /edits/{id}/details → DELETE /edits/{id}
 */
export async function fetchAppDefaultLanguage(projectId: string): Promise<string> {
  const edit = await googleRequest(projectId, '/edits', { method: 'POST', body: {} })
  const editId = edit?.id
  if (!editId) throw new Error('Google Play Edits API 未回傳 edit id')

  try {
    const details = await googleRequest(projectId, `/edits/${editId}/details`)
    const lang = details?.defaultLanguage
    if (!lang) throw new Error('Google Play 尚未設定 App 預設語言')
    return lang
  } finally {
    try {
      await googleRequest(projectId, `/edits/${editId}`, { method: 'DELETE' })
    } catch {
      // Ignore cleanup errors; edit will auto-expire.
    }
  }
}
