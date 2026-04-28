import { GoogleAuth } from 'google-auth-library'
import { loadCredentials } from '../credential-store'
import { fetchWithRetry } from '../http-retry'
import { t } from '../../i18n'

const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
// Allowlist for absolute URLs — currently only the Android Publisher host.
const ALLOWED_HOSTS = new Set(['androidpublisher.googleapis.com'])

let cachedAuth: { projectId: string; auth: GoogleAuth } | null = null

// Invalidate the cached GoogleAuth instance. Pass a projectId to clear only
// when the cache is for that project (typical case: credentials just changed
// for that project); omit it to flush unconditionally.
export function clearGoogleAuthCache(projectId?: string): void {
  if (!projectId || cachedAuth?.projectId === projectId) {
    cachedAuth = null
  }
}

function getAuth(projectId: string): { auth: GoogleAuth; packageName: string } {
  const creds = loadCredentials(projectId)
  if (!creds.google) throw new Error(t('credentials.google.notSet'))

  if (!cachedAuth || cachedAuth.projectId !== projectId) {
    const serviceAccount = JSON.parse(creds.google.serviceAccountJson)
    cachedAuth = {
      projectId,
      auth: new GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/androidpublisher']
      })
    }
  }

  return { auth: cachedAuth.auth, packageName: creds.google.packageName }
}

export async function googleRequest(
  projectId: string,
  path: string,
  options: { method?: string; body?: any } = {},
  baseUrl?: string
): Promise<any> {
  const { auth, packageName } = getAuth(projectId)
  const client = await auth.getClient()
  const token = await client.getAccessToken()

  const base = baseUrl || API_BASE
  let url: string
  if (path.startsWith('http')) {
    // Absolute URL (e.g. follow-up pagination) — verify the host is one we
    // expect before sending the bearer token to it.
    let parsed: URL
    try {
      parsed = new URL(path)
    } catch {
      throw new Error(t('google.api.invalidUrl', { path }))
    }
    if (!ALLOWED_HOSTS.has(parsed.host)) {
      throw new Error(t('google.api.forbiddenHost', { host: parsed.host }))
    }
    url = path
  } else {
    url = `${base}/${packageName}${path}`
  }

  const response = await fetchWithRetry(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  if (!response.ok) {
    const body = await response.text()
    let errorMsg = t('google.api.apiError', { status: response.status })
    try {
      const parsed = JSON.parse(body)
      if (parsed.error?.message) {
        errorMsg = parsed.error.message
      }
    } catch {
      // use default message
    }
    throw new Error(errorMsg)
  }

  if (response.status === 204) return null
  return response.json()
}

export function getPackageName(projectId: string): string {
  const creds = loadCredentials(projectId)
  if (!creds.google) throw new Error(t('credentials.google.notSet'))
  return creds.google.packageName
}
