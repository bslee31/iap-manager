import { SignJWT, importPKCS8 } from 'jose'

const TOKEN_DURATION = 15 * 60 // 15 minutes

let cachedToken: { token: string; expiresAt: number } | null = null

export async function generateAppleJwt(
  keyId: string,
  issuerId: string,
  privateKeyPem: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token
  }

  const privateKey = await importPKCS8(privateKeyPem, 'ES256')

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_DURATION)
    .setAudience('appstoreconnect-v1')
    .sign(privateKey)

  cachedToken = { token, expiresAt: now + TOKEN_DURATION }
  return token
}

export function clearTokenCache(): void {
  cachedToken = null
}
