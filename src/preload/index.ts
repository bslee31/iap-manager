import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Projects
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (data: { name: string; description?: string }) =>
    ipcRenderer.invoke('project:create', data),
  updateProject: (id: string, data: { name?: string; description?: string }) =>
    ipcRenderer.invoke('project:update', id, data),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),

  // Credentials
  getCredentials: (projectId: string) =>
    ipcRenderer.invoke('credential:get', projectId),
  saveAppleCredentials: (projectId: string, creds: unknown) =>
    ipcRenderer.invoke('credential:save-apple', projectId, creds),
  saveGoogleCredentials: (projectId: string, creds: unknown) =>
    ipcRenderer.invoke('credential:save-google', projectId, creds),
  testAppleConnection: (projectId: string) =>
    ipcRenderer.invoke('credential:test-apple', projectId),
  testGoogleConnection: (projectId: string) =>
    ipcRenderer.invoke('credential:test-google', projectId),
  importFile: (filters: { name: string; extensions: string[] }[]) =>
    ipcRenderer.invoke('dialog:import-file', filters),

  // Apple IAP
  fetchAppleProducts: (projectId: string) =>
    ipcRenderer.invoke('apple:fetch-products', projectId),
  getCachedAppleProducts: (projectId: string) =>
    ipcRenderer.invoke('apple:get-cached-products', projectId),
  syncAppleAvailability: (projectId: string, iapId: string) =>
    ipcRenderer.invoke('apple:sync-availability', projectId, iapId),
  createAppleProduct: (projectId: string, data: unknown) =>
    ipcRenderer.invoke('apple:create-product', projectId, data),
  batchUpdateAppleAvailability: (projectId: string, ids: string[], available: boolean) =>
    ipcRenderer.invoke('apple:batch-availability', projectId, ids, available),

  // Google Products
  fetchGoogleProducts: (projectId: string) =>
    ipcRenderer.invoke('google:fetch-products', projectId),
  getCachedGoogleProducts: (projectId: string) =>
    ipcRenderer.invoke('google:get-cached-products', projectId),
  createGoogleProduct: (projectId: string, data: unknown) =>
    ipcRenderer.invoke('google:create-product', projectId, data),
  batchUpdateGoogleStatus: (projectId: string, ids: string[], active: boolean, products: unknown[]) =>
    ipcRenderer.invoke('google:batch-status', projectId, ids, active, products),

  // Progress events
  onSyncProgress: (callback: (data: { current: number; total: number; phase: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('sync:progress', listener)
    return () => ipcRenderer.removeListener('sync:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
