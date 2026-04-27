import { SignJWT, importPKCS8 } from 'jose'

const TOKEN_DURATION = 15 * 60 // 15 minutes

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function generateAppleJwt(
  keyId: string,
  issuerId: string,
  privateKeyPem: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const cacheKey = `${issuerId}:${keyId}`

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

export function clearTokenCache(): void {
  tokenCache.clear()
}
