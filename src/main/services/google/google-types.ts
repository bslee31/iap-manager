export interface GoogleOneTimeProduct {
  packageName: string
  productId: string
  purchaseType: string
  listings: {
    [locale: string]: {
      title: string
      description: string
    }
  }
  defaultPrice?: {
    priceMicros: string
    currency: string
  }
  status: string
}

export interface CreateGoogleProductPayload {
  productId: string
  name: string
  description: string
  defaultPriceMicros?: string
  defaultCurrency?: string
}

// ── Export / Import format ──
// formatVersion bumped only when incompatible changes are made.
export const GOOGLE_EXPORT_FORMAT_VERSION = 1

export interface ExportedGoogleListing {
  languageCode: string
  title: string
  description: string
}

// Price for a single region inside a purchase option. Units/nanos mirror the
// Google Play Developer API shape so the export is a lossless round-trip.
export interface ExportedGoogleRegionPrice {
  regionCode: string
  availability: string
  currencyCode: string
  units: string
  nanos: number
}

export interface ExportedGooglePurchaseOption {
  purchaseOptionId: string
  state: string
  type: 'BUY' | 'RENT' | 'UNKNOWN'
  legacyCompatible: boolean
  regions: ExportedGoogleRegionPrice[]
}

export interface ExportedGoogleProduct {
  productId: string
  listings: ExportedGoogleListing[]
  purchaseOptions: ExportedGooglePurchaseOption[]
}

export interface GoogleExportData {
  formatVersion: number
  exportedAt: string
  packageName: string
  products: ExportedGoogleProduct[]
}

export interface GoogleExportError {
  productId: string
  error: string
}

export interface GoogleExportResult {
  cancelled: boolean
  filePath?: string
  total: number
  exported: number
  errors: GoogleExportError[]
}

export interface GoogleImportValidationIssue {
  index: number // position in file.products array
  productId?: string
  field: string
  message: string
}

export interface GoogleImportPreview {
  valid: boolean
  formatVersion?: number
  exportedAt?: string
  packageName?: string
  products: ExportedGoogleProduct[]
  issues: GoogleImportValidationIssue[]
}

export interface GoogleImportStepError {
  step: string
  target?: string
  error: string
}

export interface GoogleImportProductResult {
  productId: string
  created: boolean
  stepErrors: GoogleImportStepError[]
  skippedRegions: string[]
}

export interface GoogleImportResult {
  results: GoogleImportProductResult[]
}
