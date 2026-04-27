import { SignJWT, importPKCS8 } from 'jose'

const TOKEN_DURATION = 15 * 60 // 15 minutes

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function generateAppleJwt(
  keyId: string,
  issuerId: string,
  privateKeyPem: string,
  // Including projectId in the cache key prevents cross-project contamination
  // when two projects happen to share an issuer / key ID. Optional so existing
  // call sites that don't yet thread projectId through still work; once all
  // callers pass it, this can be made required.
  projectId?: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const cacheKey = projectId
    ? `${projectId}:${issuerId}:${keyId}`
    : `${issuerId}:${keyId}`

  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > now + 60) {
    return cached.token
  }

  const privateKey = await importPKCS8(privateKeyPem, 'ES256')

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_DURATION)
    .setAudience('appstoreconnect-v1')
    .sign(privateKey)

  tokenCache.set(cacheKey, { token, expiresAt: now + TOKEN_DURATION })
  return token
}

// Invalidate cached JWTs. Pass a projectId to clear only that project's
// entries (used when credentials are saved/deleted for a single project);
// omit it to flush everything (used on shutdown / wholesale resets).
export function clearTokenCache(projectId?: string): void {
  if (!projectId) {
    tokenCache.clear()
    return
  }
  const prefix = `${projectId}:`
  for (const key of tokenCache.keys()) {
    if (key.startsWith(prefix)) tokenCache.delete(key)
  }
}
