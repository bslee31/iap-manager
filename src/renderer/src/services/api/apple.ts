// Apple App Store Connect IPC wrappers. Names drop the redundant "Apple"
// prefix that the preload layer carries — call sites read as
// appleApi.fetchProducts() instead of appleApi.fetchAppleProducts().

// ── Products ──

export function fetchProducts(projectId: string) {
  return window.api.fetchAppleProducts(projectId)
}

export function getCachedProducts(projectId: string) {
  return window.api.getCachedAppleProducts(projectId)
}

export function syncAvailability(projectId: string, iapId: string) {
  return window.api.syncAppleAvailability(projectId, iapId)
}

export function createProduct(projectId: string, data: unknown) {
  return window.api.createAppleProduct(projectId, data)
}

export function updateProduct(
  projectId: string,
  iapId: string,
  updates: { referenceName?: string }
) {
  return window.api.updateAppleProduct(projectId, iapId, updates)
}

export function batchUpdateAvailability(
  projectId: string,
  ids: string[],
  available: boolean
) {
  return window.api.batchUpdateAppleAvailability(projectId, ids, available)
}

export function syncBasePrice(projectId: string, iapId: string) {
  return window.api.syncAppleBasePrice(projectId, iapId)
}

// ── Detail: Availability ──

export function getAvailabilityDetail(projectId: string, iapId: string) {
  return window.api.getAppleAvailabilityDetail(projectId, iapId)
}

export function updateAvailability(
  projectId: string,
  iapId: string,
  territoryIds: string[],
  availableInNewTerritories: boolean
) {
  return window.api.updateAppleAvailability(
    projectId,
    iapId,
    territoryIds,
    availableInNewTerritories
  )
}

export function getAllTerritories(projectId: string) {
  return window.api.getAllTerritories(projectId)
}

// ── Detail: Localization ──

export function getLocalizations(projectId: string, iapId: string) {
  return window.api.getAppleLocalizations(projectId, iapId)
}

export function createLocalization(
  projectId: string,
  iapId: string,
  data: { locale: string; name: string; description?: string }
) {
  return window.api.createAppleLocalization(projectId, iapId, data)
}

export function updateLocalization(
  projectId: string,
  localizationId: string,
  data: { name?: string; description?: string }
) {
  return window.api.updateAppleLocalization(projectId, localizationId, data)
}

export function deleteLocalization(projectId: string, localizationId: string) {
  return window.api.deleteAppleLocalization(projectId, localizationId)
}

// ── Detail: Price Schedule ──

export function getPriceSchedule(projectId: string, iapId: string) {
  return window.api.getApplePriceSchedule(projectId, iapId)
}

export function getPricePoints(projectId: string, iapId: string, territory: string) {
  return window.api.getApplePricePoints(projectId, iapId, territory)
}

export function setPriceSchedule(
  projectId: string,
  iapId: string,
  baseTerritory: string,
  pricePointId: string
) {
  return window.api.setApplePriceSchedule(projectId, iapId, baseTerritory, pricePointId)
}

export function getPrimaryLocale(projectId: string) {
  return window.api.getApplePrimaryLocale(projectId)
}

export function setManualTerritoryPrice(
  projectId: string,
  iapId: string,
  territory: string,
  pricePointId: string
) {
  return window.api.setAppleManualTerritoryPrice(projectId, iapId, territory, pricePointId)
}

export function getAllTerritoryPrices(projectId: string, iapId: string) {
  return window.api.getAppleAllTerritoryPrices(projectId, iapId)
}

// ── Import / Export ──

export function exportProducts(
  projectId: string,
  products: { id: string; productId: string; referenceName: string; type: string }[]
) {
  return window.api.exportAppleProducts(projectId, products)
}

export function validateImport(
  projectId: string,
  fileContent: string,
  existingProductIds: string[]
) {
  return window.api.validateAppleImport(projectId, fileContent, existingProductIds)
}

export function executeImport(
  projectId: string,
  products: unknown[],
  territoryCurrencyMap: Record<string, string>
) {
  return window.api.executeAppleImport(projectId, products, territoryCurrencyMap)
}
