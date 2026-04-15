import { GoogleAuth } from 'google-auth-library'
import { loadCredentials } from '../credential-store'

const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'

let cachedAuth: { projectId: string; auth: GoogleAuth } | null = null

function getAuth(projectId: string): { auth: GoogleAuth; packageName: string } {
  const creds = loadCredentials(projectId)
  if (!creds.google) throw new Error('Google 憑證未設定')

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
  const url = path.startsWith('http') ? path : `${base}/${packageName}${path}`

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  if (!response.ok) {
    const body = await response.text()
    let errorMsg = `Google API 錯誤 (${response.status})`
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
  if (!creds.google) throw new Error('Google 憑證未設定')
  return creds.google.packageName
}
