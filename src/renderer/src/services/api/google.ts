// Google Play Console IPC wrappers. Names drop the redundant "Google"
// prefix that the preload layer carries — call sites read as
// googleApi.fetchProducts() instead of googleApi.fetchGoogleProducts().

// ── Products ──

export function fetchProducts(projectId: string) {
  return window.api.fetchGoogleProducts(projectId)
}

export function getCachedProducts(projectId: string) {
  return window.api.getCachedGoogleProducts(projectId)
}

export function createProduct(projectId: string, data: unknown) {
  return window.api.createGoogleProduct(projectId, data)
}

export function batchUpdateStatus(
  projectId: string,
  ids: string[],
  active: boolean,
  products: unknown[]
) {
  return window.api.batchUpdateGoogleStatus(projectId, ids, active, products)
}

// ── Detail ──

export function getProductDetail(projectId: string, productId: string) {
  return window.api.getGoogleProductDetail(projectId, productId)
}

export function updateListings(
  projectId: string,
  productId: string,
  listings: { languageCode: string; title: string; description: string }[]
) {
  return window.api.updateGoogleListings(projectId, productId, listings)
}

export function setPurchaseOptionState(
  projectId: string,
  productId: string,
  purchaseOptionId: string,
  active: boolean
) {
  return window.api.setGooglePurchaseOptionState(projectId, productId, purchaseOptionId, active)
}

export function updatePurchaseOptionPricing(
  projectId: string,
  productId: string,
  purchaseOptionId: string,
  basePrice: { currencyCode: string; units: string; nanos: number },
  baseRegionCode: string
) {
  return window.api.updateGooglePurchaseOptionPricing(
    projectId,
    productId,
    purchaseOptionId,
    basePrice,
    baseRegionCode
  )
}

export function addPurchaseOption(
  projectId: string,
  productId: string,
  purchaseOptionId: string,
  basePrice: { currencyCode: string; units: string; nanos: number },
  baseRegionCode: string
) {
  return window.api.addGooglePurchaseOption(
    projectId,
    productId,
    purchaseOptionId,
    basePrice,
    baseRegionCode
  )
}

export function setLegacyCompatible(
  projectId: string,
  productId: string,
  purchaseOptionId: string
) {
  return window.api.setGoogleLegacyCompatible(projectId, productId, purchaseOptionId)
}

// ── Settings ──

export function getSettings(projectId: string) {
  return window.api.getGoogleSettings(projectId)
}

export function getRegions(projectId: string) {
  return window.api.getGoogleRegions(projectId)
}

export function setDefaultLanguage(projectId: string, languageCode: string | null) {
  return window.api.setGoogleDefaultLanguage(projectId, languageCode)
}

export function setBaseRegion(projectId: string, regionCode: string | null) {
  return window.api.setGoogleBaseRegion(projectId, regionCode)
}

export function detectDefaultLanguage(projectId: string) {
  return window.api.detectGoogleDefaultLanguage(projectId)
}

// ── Import / Export ──

export function exportProducts(projectId: string, products: { productId: string }[]) {
  return window.api.exportGoogleProducts(projectId, products)
}

export function validateImport(
  projectId: string,
  fileContent: string,
  existingProductIds: string[]
) {
  return window.api.validateGoogleImport(projectId, fileContent, existingProductIds)
}

export function executeImport(projectId: string, products: unknown[]) {
  return window.api.executeGoogleImport(projectId, products)
}
