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
