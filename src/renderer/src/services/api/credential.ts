// Credential save/get/test wrappers. The renderer never touches the raw
// secret — it sends fields to the main process, which encrypts via Electron
// safeStorage and persists. `get` returns redacted metadata only (presence
// flags, never the private key or service-account JSON).

export function get(projectId: string) {
  return window.api.getCredentials(projectId)
}

export function saveApple(projectId: string, creds: unknown) {
  return window.api.saveAppleCredentials(projectId, creds)
}

export function saveGoogle(projectId: string, creds: unknown) {
  return window.api.saveGoogleCredentials(projectId, creds)
}

export function testApple(projectId: string) {
  return window.api.testAppleConnection(projectId)
}

export function testGoogle(projectId: string) {
  return window.api.testGoogleConnection(projectId)
}
