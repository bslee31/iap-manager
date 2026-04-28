import { googleRequest } from './google-auth'
import { t } from '../../i18n'

/**
 * Detect the app's default language via the Edits API.
 * Flow: POST /edits → GET /edits/{id}/details → DELETE /edits/{id}
 */
export async function fetchAppDefaultLanguage(projectId: string): Promise<string> {
  const edit = await googleRequest(projectId, '/edits', { method: 'POST', body: {} })
  const editId = edit?.id
  if (!editId) throw new Error(t('google.edits.noEditId'))

  try {
    const details = await googleRequest(projectId, `/edits/${editId}/details`)
    const lang = details?.defaultLanguage
    if (!lang) throw new Error(t('google.edits.noDefaultLanguage'))
    return lang
  } finally {
    try {
      await googleRequest(projectId, `/edits/${editId}`, { method: 'DELETE' })
    } catch {
      // Ignore cleanup errors; edit will auto-expire.
    }
  }
}
