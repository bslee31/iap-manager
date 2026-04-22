import { googleRequest, getPackageName } from './google-auth'

export interface GoogleProductItem {
  productId: string
  name: string
  description: string
  status: string
  purchaseOptionId?: string
  purchaseOptionCount?: number
  defaultPrice?: string
}

// List one-time products (uses camelCase: oneTimeProducts)
export async function listOneTimeProducts(
  projectId: string
): Promise<GoogleProductItem[]> {
  const allProducts: GoogleProductItem[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams()
    if (pageToken) params.set('pageToken', pageToken)
    params.set('pageSize', '100')
    const query = params.toString() ? `?${params}` : ''
    const resp = await googleRequest(projectId, `/oneTimeProducts${query}`)

    const products = resp.oneTimeProducts || []
    for (const p of products) {
      // Get listing: prefer zh-TW, then en-US, then first available
      let listing: any = {}
      if (Array.isArray(p.listings)) {
        listing = p.listings.find((l: any) => l.languageCode === 'zh-TW')
          || p.listings.find((l: any) => l.languageCode === 'en-US')
          || p.listings[0] || {}
      } else if (p.listings && typeof p.listings === 'object') {
        listing = p.listings['zh-TW'] || p.listings['en-US']
          || Object.values(p.listings)[0] || {}
      }

      // Get purchase options info
      const purchaseOptions = Array.isArray(p.purchaseOptions) ? p.purchaseOptions : []
      const activePO = purchaseOptions.find((po: any) => po.state === 'ACTIVE')
      const firstPO = purchaseOptions[0]

      // Determine status: if any PO is ACTIVE -> active, else use first PO state, else no PO
      let status = 'NO_PURCHASE_OPTION'
      if (activePO) {
        status = 'ACTIVE'
      } else if (firstPO) {
        status = firstPO.state || 'DRAFT'
      }

      allProducts.push({
        productId: p.productId || '',
        name: listing.title || p.productId || '',
        description: listing.description || '',
        status,
        purchaseOptionId: (activePO || firstPO)?.purchaseOptionId || '',
        purchaseOptionCount: purchaseOptions.length,
        defaultPrice: undefined
      })
    }

    pageToken = resp.nextPageToken
  } while (pageToken)

  return allProducts
}

// Batch activate/deactivate via purchaseOptions:batchUpdateStates
export async function batchUpdateStatus(
  projectId: string,
  productIds: string[],
  active: boolean,
  products: GoogleProductItem[]
): Promise<{ success: string[]; failed: { id: string; error: string }[] }> {
  const packageName = getPackageName(projectId)
  const success: string[] = []
  const failed: { id: string; error: string }[] = []

  // Build requests - need purchaseOptionId for each product
  const requests: any[] = []
  const requestProductIds: string[] = []

  for (const pid of productIds) {
    const product = products.find((p) => p.productId === pid)
    if (!product?.purchaseOptionId) {
      failed.push({ id: pid, error: '找不到 Purchase Option ID' })
      continue
    }

    const reqBody = active
      ? {
          activatePurchaseOptionRequest: {
            packageName,
            productId: pid,
            purchaseOptionId: product.purchaseOptionId
          }
        }
      : {
          deactivatePurchaseOptionRequest: {
            packageName,
            productId: pid,
            purchaseOptionId: product.purchaseOptionId
          }
        }

    requests.push(reqBody)
    requestProductIds.push(pid)
  }

  if (requests.length === 0) return { success, failed }

  // Process each product individually with its own endpoint
  for (let i = 0; i < requests.length; i++) {
    const pid = requestProductIds[i]
    const req = requests[i]
    try {
      const resp = await googleRequest(
        projectId,
        `/oneTimeProducts/${pid}/purchaseOptions:batchUpdateStates`,
        {
          method: 'POST',
          body: { requests: [req] }
        }
      )
      success.push(pid)
    } catch (e: any) {
      failed.push({ id: pid, error: e.message })
    }
  }

  return { success, failed }
}

// Create a one-time product (uses lowercase: onetimeproducts)
export async function createOneTimeProduct(
  projectId: string,
  data: { productId: string; name: string; description: string; languageCode: string }
): Promise<any> {
  return googleRequest(projectId, `/onetimeproducts/${data.productId}?allowMissing=true`, {
    method: 'PATCH',
    body: {
      productId: data.productId,
      listings: [
        {
          languageCode: data.languageCode,
          title: data.name,
          description: data.description
        }
      ]
    }
  })
}

// Test connection
export async function testConnection(projectId: string): Promise<void> {
  await googleRequest(projectId, `/oneTimeProducts?pageSize=1`)
}
