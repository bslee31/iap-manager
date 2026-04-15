import { ipcMain, BrowserWindow } from 'electron'
import {
  findAllProjects,
  createProject,
  updateProject,
  deleteProject
} from './db/repositories/project.repo'
import {
  saveAppleCredentials,
  saveGoogleCredentials,
  loadCredentials,
  importFileDialog,
  deleteCredentials,
  type AppleCredentials,
  type GoogleCredentials
} from './services/credential-store'
import { getDatabase } from './db/database'
import {
  listInAppPurchases,
  createInAppPurchase,
  batchUpdateAvailability,
  getExistingAvailability,
  testConnection as testAppleConnection
} from './services/apple/apple-iap'
import type { CreateIapPayload } from './services/apple/apple-types'
import {
  listOneTimeProducts,
  createOneTimeProduct,
  batchUpdateStatus as googleBatchUpdateStatus,
  testConnection as testGoogleConnection
} from './services/google/google-product'

export function registerIpcHandlers(): void {
  // ── Project CRUD ──

  ipcMain.handle('project:list', async () => {
    try {
      const projects = findAllProjects()
      return projects.map((p) => ({
        ...p,
        has_apple: !!p.has_apple,
        has_google: !!p.has_google
      }))
    } catch (e: any) {
      console.error('project:list error', e)
      return []
    }
  })

  ipcMain.handle('project:create', async (_event, data: { name: string; description?: string }) => {
    try {
      const project = createProject(data)
      return { success: true, data: project }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'project:update',
    async (_event, id: string, data: { name?: string; description?: string }) => {
      try {
        const project = updateProject(id, data)
        if (!project) return { success: false, error: '專案不存在' }
        return { success: true, data: project }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle('project:delete', async (_event, id: string) => {
    try {
      const deleted = deleteProject(id)
      if (deleted) deleteCredentials(id)
      if (!deleted) return { success: false, error: '專案不存在' }
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // ── Credentials ──

  ipcMain.handle(
    'credential:save-apple',
    async (_event, projectId: string, creds: AppleCredentials) => {
      try {
        saveAppleCredentials(projectId, creds)
        const db = getDatabase()
        db.prepare('UPDATE project_credentials SET has_apple = 1 WHERE project_id = ?').run(projectId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'credential:save-google',
    async (_event, projectId: string, creds: GoogleCredentials) => {
      try {
        saveGoogleCredentials(projectId, creds)
        const db = getDatabase()
        db.prepare('UPDATE project_credentials SET has_google = 1 WHERE project_id = ?').run(projectId)
        return { success: true }
      } catch (e: any) {
        return { success: false, error: e.message }
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
            ? { keyId: creds.apple.keyId, issuerId: creds.apple.issuerId, appId: creds.apple.appId, hasPrivateKey: true }
            : null,
          google: creds.google
            ? { packageName: creds.google.packageName, hasServiceAccount: true }
            : null
        }
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('credential:test-apple', async (_event, projectId: string) => {
    try {
      await testAppleConnection(projectId)
      return { success: true, message: 'Apple API 連線成功' }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('credential:test-google', async (_event, projectId: string) => {
    try {
      await testGoogleConnection(projectId)
      return { success: true, message: 'Google API 連線成功' }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'dialog:import-file',
    async (_event, filters: { name: string; extensions: string[] }[]) => {
      try {
        const content = await importFileDialog(filters)
        return { success: true, data: content }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  // ── Apple IAP ──

  ipcMain.handle('apple:fetch-products', async (event, projectId: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const onProgress = (current: number, total: number, phase: string) => {
        win?.webContents.send('sync:progress', { current, total, phase })
      }

      const results = await listInAppPurchases(projectId, onProgress)

      // Cache to local DB
      const db = getDatabase()
      const now = new Date().toISOString()
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO apple_products (id, project_id, product_id, reference_name, product_type, state, available, territory_count, sort_order, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const tx = db.transaction(() => {
        let idx = 0
        for (const { iap, territoryCount } of results) {
          upsert.run(
            iap.id,
            projectId,
            iap.attributes.productId,
            iap.attributes.referenceName || iap.attributes.name,
            iap.attributes.inAppPurchaseType,
            iap.attributes.state,
            territoryCount > 0 ? 1 : 0,
            territoryCount,
            idx++,
            now
          )
        }
      })
      tx()

      return {
        success: true,
        data: results.map(({ iap, territoryCount }) => ({
          id: iap.id,
          productId: iap.attributes.productId,
          referenceName: iap.attributes.referenceName || iap.attributes.name,
          type: iap.attributes.inAppPurchaseType,
          state: iap.attributes.state,
          territoryCount,
          syncedAt: now
        }))
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('apple:get-cached-products', async (_event, projectId: string) => {
    try {
      const db = getDatabase()
      const rows = db
        .prepare('SELECT * FROM apple_products WHERE project_id = ? ORDER BY sort_order')
        .all(projectId) as any[]
      return {
        success: true,
        data: rows.map((r: any) => ({
          id: r.id,
          productId: r.product_id,
          referenceName: r.reference_name,
          type: r.product_type,
          state: r.state,
          territoryCount: r.territory_count ?? 0,
          syncedAt: r.synced_at
        }))
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'apple:sync-availability',
    async (_event, projectId: string, iapId: string) => {
      try {
        const avail = await getExistingAvailability(projectId, iapId)
        const territoryCount = avail ? avail.territoryIds.length : 0

        // Update DB
        const db = getDatabase()
        db.prepare(
          'UPDATE apple_products SET territory_count = ?, available = ? WHERE id = ?'
        ).run(territoryCount, territoryCount > 0 ? 1 : 0, iapId)

        return { success: true, data: { territoryCount } }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'apple:create-product',
    async (_event, projectId: string, data: CreateIapPayload) => {
      try {
        const product = await createInAppPurchase(projectId, data)
        return { success: true, data: product }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'apple:batch-availability',
    async (
      _event,
      projectId: string,
      iapIds: string[],
      activate: boolean
    ) => {
      try {
        const result = await batchUpdateAvailability(
          projectId,
          iapIds,
          activate
        )
        return { success: true, data: result }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  // ── Google Products ──

  ipcMain.handle('google:fetch-products', async (event, projectId: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      win?.webContents.send('sync:progress', { current: 0, total: 0, phase: '正在從 Google Play 同步...' })
      const products = await listOneTimeProducts(projectId)
      win?.webContents.send('sync:progress', { current: products.length, total: products.length, phase: `已取得 ${products.length} 個商品` })
      // Cache to local DB
      const db = getDatabase()
      const now = new Date().toISOString()
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO google_products (id, project_id, product_id, name, description, status, purchase_option_id, sort_order, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const tx = db.transaction(() => {
        let idx = 0
        for (const p of products) {
          upsert.run(p.productId, projectId, p.productId, p.name, p.description, p.status, p.purchaseOptionId || null, idx++, now)
        }
      })
      tx()

      return {
        success: true,
        data: products.map((p) => ({ ...p, syncedAt: now }))
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('google:get-cached-products', async (_event, projectId: string) => {
    try {
      const db = getDatabase()
      const rows = db
        .prepare('SELECT * FROM google_products WHERE project_id = ? ORDER BY sort_order')
        .all(projectId) as any[]
      return {
        success: true,
        data: rows.map((r: any) => ({
          productId: r.product_id,
          name: r.name,
          description: r.description,
          status: r.status,
          purchaseOptionId: r.purchase_option_id || '',
          syncedAt: r.synced_at
        }))
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle(
    'google:create-product',
    async (_event, projectId: string, data: { productId: string; name: string; description: string }) => {
      try {
        const product = await createOneTimeProduct(projectId, data)
        return { success: true, data: product }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )

  ipcMain.handle(
    'google:batch-status',
    async (_event, projectId: string, productIds: string[], active: boolean, products: any[]) => {
      try {
        const result = await googleBatchUpdateStatus(projectId, productIds, active, products)
        return { success: true, data: result }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }
  )
}
