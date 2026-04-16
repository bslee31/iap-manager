import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Projects
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (data: { name: string; description?: string }) =>
    ipcRenderer.invoke('project:create', data),
  updateProject: (id: string, data: { name?: string; description?: string }) =>
    ipcRenderer.invoke('project:update', id, data),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  reorderProjects: (orderedIds: string[]) => ipcRenderer.invoke('project:reorder', orderedIds),

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

  // Apple IAP Detail
  getAppleAvailabilityDetail: (projectId: string, iapId: string) =>
    ipcRenderer.invoke('apple:get-availability-detail', projectId, iapId),
  updateAppleAvailability: (projectId: string, iapId: string, territoryIds: string[], availableInNewTerritories: boolean) =>
    ipcRenderer.invoke('apple:update-availability', projectId, iapId, territoryIds, availableInNewTerritories),
  getAllTerritories: (projectId: string) =>
    ipcRenderer.invoke('apple:get-all-territories', projectId),
  getAppleLocalizations: (projectId: string, iapId: string) =>
    ipcRenderer.invoke('apple:get-localizations', projectId, iapId),
  createAppleLocalization: (projectId: string, iapId: string, data: { locale: string; name: string; description?: string }) =>
    ipcRenderer.invoke('apple:create-localization', projectId, iapId, data),
  updateAppleLocalization: (projectId: string, localizationId: string, data: { name?: string; description?: string }) =>
    ipcRenderer.invoke('apple:update-localization', projectId, localizationId, data),
  deleteAppleLocalization: (projectId: string, localizationId: string) =>
    ipcRenderer.invoke('apple:delete-localization', projectId, localizationId),
  getApplePriceSchedule: (projectId: string, iapId: string) =>
    ipcRenderer.invoke('apple:get-price-schedule', projectId, iapId),
  getApplePricePoints: (projectId: string, iapId: string, territory: string) =>
    ipcRenderer.invoke('apple:get-price-points', projectId, iapId, territory),
  setApplePriceSchedule: (projectId: string, iapId: string, baseTerritory: string, pricePointId: string) =>
    ipcRenderer.invoke('apple:set-price-schedule', projectId, iapId, baseTerritory, pricePointId),
  getApplePrimaryLocale: (projectId: string) =>
    ipcRenderer.invoke('apple:get-primary-locale', projectId),
  setAppleManualTerritoryPrice: (projectId: string, iapId: string, territory: string, pricePointId: string) =>
    ipcRenderer.invoke('apple:set-manual-territory-price', projectId, iapId, territory, pricePointId),
  syncAppleBasePrice: (projectId: string, iapId: string) =>
    ipcRenderer.invoke('apple:sync-base-price', projectId, iapId),
  getAppleAllTerritoryPrices: (projectId: string, iapId: string) =>
    ipcRenderer.invoke('apple:get-all-territory-prices', projectId, iapId),

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
