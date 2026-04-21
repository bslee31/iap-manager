export interface AppleInAppPurchase {
  id: string
  type: string
  attributes: {
    name: string
    productId: string
    inAppPurchaseType: string
    state: string
    reviewNote?: string
    referenceName?: string
  }
}

export interface AppleLocalization {
  id: string
  attributes: {
    locale: string
    name: string
    description?: string
  }
}

export interface ApplePricePoint {
  id: string
  attributes: {
    customerPrice: string
    proceeds: string
    priceTier?: string
  }
  relationships?: {
    territory?: {
      data: { id: string }
    }
  }
}

export interface AppleTerritory {
  id: string
  attributes: {
    currency: string
  }
}

export interface AppleApiResponse<T> {
  data: T
  links?: { next?: string }
  meta?: { paging?: { total: number } }
  included?: any[]
}

export interface AppleApiListResponse<T> {
  data: T[]
  links?: { next?: string }
  meta?: { paging?: { total: number } }
  included?: any[]
}

export interface CreateIapPayload {
  productId: string
  referenceName: string
  inAppPurchaseType: 'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION'
  reviewNote?: string
  appId: string
}

export interface BatchAvailabilityPayload {
  productIds: string[]
  availableInNewTerritories: boolean
  territoryIds?: string[]
}

// Availability detail
export interface AvailabilityDetail {
  availableInNewTerritories: boolean
  territoryIds: string[]
}

// Full territory info
export interface TerritoryInfo {
  id: string
  currency: string
}

// Localization detail
export interface IapLocalization {
  id: string
  locale: string
  name: string
  description: string
}

// Price schedule
export interface IapPriceInfo {
  startDate: string | null
  endDate: string | null
  territory: string
  price: string
  pricePointId: string
}

export interface IapPricePoint {
  id: string
  customerPrice: string
  proceeds: string
  territory: string
}

export interface TerritoryPrice {
  territory: string
  currency: string
  customerPrice: string
  proceeds: string
  isManual: boolean
}

// ── Export / Import format ──
// formatVersion bumped only when incompatible changes are made
export const EXPORT_FORMAT_VERSION = 1

export interface ExportedAvailability {
  territories: string[]
  availableInNewTerritories: boolean
}

export interface ExportedCustomPrice {
  territory: string
  price: string
}

export interface ExportedPriceSchedule {
  baseTerritory: string
  basePrice: string
  customPrices?: ExportedCustomPrice[]
}

export interface ExportedLocalization {
  locale: string
  name: string
  description: string
}

export interface ExportedProduct {
  productId: string
  referenceName: string
  type: string
  availability: ExportedAvailability
  priceSchedule?: ExportedPriceSchedule
  localizations?: ExportedLocalization[]
}

export interface ExportData {
  formatVersion: number
  exportedAt: string
  appId: string
  products: ExportedProduct[]
}

export interface ExportError {
  productId: string
  referenceName: string
  error: string
}

export interface ExportResult {
  cancelled: boolean
  filePath?: string
  total: number
  exported: number
  errors: ExportError[]
}
