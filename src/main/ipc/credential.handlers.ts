import { ipcMain } from 'electron'
import {
  saveAppleCredentials,
  saveGoogleCredentials,
  loadCredentials,
  importFileDialog,
  type AppleCredentials,
  type GoogleCredentials
} from '../services/credential-store'
import { getDatabase } from '../db/database'
import { clearTokenCache as clearAppleTokenCache } from '../services/apple/apple-auth'
import { clearGoogleAuthCache } from '../services/google/google-auth'
import { testConnection as testAppleConnection } from '../services/apple/apple-iap'
import { testConnection as testGoogleConnection } from '../services/google/google-product'
import { sanitizeError } from './sanitize-error'
import { t } from '../i18n'

export function registerCredentialHandlers(): void {
  ipcMain.handle(
    'credential:save-apple',
    async (_event, projectId: string, creds: AppleCredentials) => {
      try {
        saveAppleCredentials(projectId, creds)
        const db = getDatabase()
        db.prepare('UPDATE project_credentials SET has_apple = 1 WHERE project_id = ?').run(
          projectId
        )
        // JWT cache is keyed by (projectId, issuerId, keyId); invalidate
        // entries for this project so the next request re-signs with the
        // new key instead of waiting up to 15 minutes for the old token
        // to expire.
        clearAppleTokenCache(projectId)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle(
    'credential:save-google',
    async (_event, projectId: string, creds: Partial<GoogleCredentials>) => {
      try {
        saveGoogleCredentials(projectId, creds)
        const db = getDatabase()
        db.prepare('UPDATE project_credentials SET has_google = 1 WHERE project_id = ?').run(
          projectId
        )
        // GoogleAuth instance is cached per project — drop it so the next
        // request rebuilds it with the new service-account JSON.
        clearGoogleAuthCache(projectId)
        return { success: true }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )

  ipcMain.handle('credential:get', async (_event, projectId: string) => {
    try {
      const creds = loadCredentials(projectId)
      return {
        success: true,
        data: {
          apple: creds.apple
            ? {
                keyId: creds.apple.keyId,
                issuerId: creds.apple.issuerId,
                appId: creds.apple.appId,
                hasPrivateKey: true
              }
            : null,
          google: creds.google
            ? { packageName: creds.google.packageName, hasServiceAccount: true }
            : null
        }
      }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('credential:test-apple', async (_event, projectId: string) => {
    try {
      await testAppleConnection(projectId)
      return { success: true, message: t('credentials.test.appleSuccess') }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle('credential:test-google', async (_event, projectId: string) => {
    try {
      await testGoogleConnection(projectId)
      return { success: true, message: t('credentials.test.googleSuccess') }
    } catch (e) {
      return { success: false, error: sanitizeError(e) }
    }
  })

  ipcMain.handle(
    'dialog:import-file',
    async (_event, filters: { name: string; extensions: string[] }[]) => {
      try {
        const content = await importFileDialog(filters)
        return { success: true, data: content }
      } catch (e) {
        return { success: false, error: sanitizeError(e) }
      }
    }
  )
}
