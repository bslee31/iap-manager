import { safeStorage, dialog } from 'electron'
import { join } from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'

export interface AppleCredentials {
  keyId: string
  issuerId: string
  privateKey: string
  appId: string
}

export interface GoogleCredentials {
  serviceAccountJson: string
  packageName: string
}

export interface ProjectCredentials {
  apple?: AppleCredentials
  google?: GoogleCredentials
}

function getCredentialsDir(): string {
  const dir = join(app.getPath('home'), '.iap-manager', 'credentials')
  if (!existsSync(dir)) {
    mkdirSync(dir, { mode: 0o700, recursive: true })
  }
  return dir
}

function getCredentialPath(projectId: string): string {
  return join(getCredentialsDir(), `${projectId}.enc`)
}

export function loadCredentials(projectId: string): ProjectCredentials {
  const path = getCredentialPath(projectId)
  if (!existsSync(path)) return {}

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系統加密功能不可用')
  }

  const encrypted = readFileSync(path)
  const decrypted = safeStorage.decryptString(encrypted)
  return JSON.parse(decrypted)
}

export function saveCredentials(projectId: string, creds: ProjectCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系統加密��能不可用')
  }

  const json = JSON.stringify(creds)
  const encrypted = safeStorage.encryptString(json)
  writeFileSync(getCredentialPath(projectId), encrypted, { mode: 0o600 })
}

export function saveAppleCredentials(projectId: string, apple: AppleCredentials): void {
  const creds = loadCredentials(projectId)
  creds.apple = apple
  saveCredentials(projectId, creds)
}

export function saveGoogleCredentials(projectId: string, google: Partial<GoogleCredentials>): void {
  const creds = loadCredentials(projectId)
  creds.google = { ...creds.google, ...google } as GoogleCredentials
  saveCredentials(projectId, creds)
}

export function deleteCredentials(projectId: string): void {
  const path = getCredentialPath(projectId)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

export async function importFileDialog(
  filters: { name: string; extensions: string[] }[]
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters
  })

  if (result.canceled || result.filePaths.length === 0) return null
  return readFileSync(result.filePaths[0], 'utf-8')
}
