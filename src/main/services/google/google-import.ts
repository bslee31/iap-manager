import { googleRequest } from './google-auth'
import {
  REGIONS_VERSION,
  parseProblematicRegions,
  fetchSupportedRegions
} from './google-product'
import {
  GOOGLE_EXPORT_FORMAT_VERSION,
  type ExportedGoogleProduct,
  type ExportedGooglePurchaseOption,
  type GoogleImportPreview,
  type GoogleImportProductResult,
  type GoogleImportStepError,
  type GoogleImportValidationIssue
} from './google-types'

// Limits mirror the Play Console new-product form (verified 2026).
// Product ID: starts with number/lowercase letter; numbers, lowercase, _ and .
// Purchase Option ID: starts with number/lowercase letter; numbers, lowercase and - only (no _ or .)
const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9._]*$/
const PURCHASE_OPTION_ID_RE = /^[a-z0-9][a-z0-9-]*$/
const MAX_PRODUCT_ID = 139
const MAX_PURCHASE_OPTION_ID = 63
const MAX_TITLE = 55
const MAX_DESCRIPTION = 200
const VALID_PO_STATES = new Set(['DRAFT', 'ACTIVE', 'INACTIVE', 'INACTIVE_PUBLISHED'])
const VALID_PO_TYPES = new Set(['BUY']) // import flow only supports BUY today
const VALID_AVAILABILITY = new Set(['AVAILABLE', 'NO_LONGER_AVAILABLE'])
const IMPORT_CONCURRENCY = 3

export type GoogleImportProgressCallback = (
  current: number,
  total: number,
  phase: string
) => void

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
}

function pushIssue(
  issues: GoogleImportValidationIssue[],
  index: number,
  productId: string | undefined,
  field: string,
  message: string
): void {
  issues.push({ index, productId, field, message })
}

function validateProduct(
  p: any,
  index: number,
  validRegionCodes: Set<string>,
  seenProductIds: Set<string>,
  existingProductIds: Set<string>,
  issues: GoogleImportValidationIssue[]
): void {
  if (typeof p !== 'object' || p === null) {
    pushIssue(issues, index, undefined, '(root)', '商品必須是物件')
    return
  }

  const rawPid = p.productId
  const pid = typeof rawPid === 'string' && rawPid.length > 0 ? rawPid : undefined

  if (!pid) {
    pushIssue(issues, index, undefined, 'productId', 'productId 不可為空')
  } else if (!PRODUCT_ID_RE.test(pid)) {
    pushIssue(issues, index, pid, 'productId', 'productId 必須以小寫英數開頭，只能包含小寫英數、. _')
  } else if (pid.length > MAX_PRODUCT_ID) {
    pushIssue(issues, index, pid, 'productId', `productId 超過 ${MAX_PRODUCT_ID} 字元`)
  } else {
    if (seenProductIds.has(pid)) {
      pushIssue(issues, index, pid, 'productId', '檔案內有重複的 productId')
    }
    if (existingProductIds.has(pid)) {
      pushIssue(issues, index, pid, 'productId', '已存在於目前專案中')
    }
    seenProductIds.add(pid)
  }

  // listings
  if (!Array.isArray(p.listings) || p.listings.length === 0) {
    pushIssue(issues, index, pid, 'listings', 'listings 必須是非空陣列')
  } else {
    const seenLangs = new Set<string>()
    p.listings.forEach((l: any, lIdx: number) => {
      const prefix = `listings[${lIdx}]`
      if (typeof l?.languageCode !== 'string' || l.languageCode.length === 0) {
        pushIssue(issues, index, pid, `${prefix}.languageCode`, 'languageCode 不可為空')
      } else {
        if (seenLangs.has(l.languageCode)) {
          pushIssue(issues, index, pid, `${prefix}.languageCode`, `重複的 languageCode: ${l.languageCode}`)
        }
        seenLangs.add(l.languageCode)
      }
      if (typeof l?.title !== 'string' || l.title.length === 0) {
        pushIssue(issues, index, pid, `${prefix}.title`, 'title 不可為空')
      } else if (l.title.length > MAX_TITLE) {
        pushIssue(issues, index, pid, `${prefix}.title`, `title 超過 ${MAX_TITLE} 字元`)
      }
      if (typeof l?.description !== 'string' || l.description.length === 0) {
        pushIssue(issues, index, pid, `${prefix}.description`, 'description 不可為空')
      } else if (l.description.length > MAX_DESCRIPTION) {
        pushIssue(
          issues,
          index,
          pid,
          `${prefix}.description`,
          `description 超過 ${MAX_DESCRIPTION} 字元`
        )
      }
    })
  }

  // purchaseOptions
  if (!Array.isArray(p.purchaseOptions) || p.purchaseOptions.length === 0) {
    pushIssue(issues, index, pid, 'purchaseOptions', 'purchaseOptions 必須是非空陣列')
  } else {
    const seenPoIds = new Set<string>()
    let legacyCount = 0
    p.purchaseOptions.forEach((po: any, poIdx: number) => {
      const prefix = `purchaseOptions[${poIdx}]`
      if (typeof po?.purchaseOptionId !== 'string' || po.purchaseOptionId.length === 0) {
        pushIssue(issues, index, pid, `${prefix}.purchaseOptionId`, 'purchaseOptionId 不可為空')
      } else if (!PURCHASE_OPTION_ID_RE.test(po.purchaseOptionId)) {
        pushIssue(
          issues,
          index,
          pid,
          `${prefix}.purchaseOptionId`,
          'purchaseOptionId 必須以小寫英數開頭，只能包含小寫英數和 -（不可有 _ 或 .）'
        )
      } else if (po.purchaseOptionId.length > MAX_PURCHASE_OPTION_ID) {
        pushIssue(
          issues,
          index,
          pid,
          `${prefix}.purchaseOptionId`,
          `purchaseOptionId 超過 ${MAX_PURCHASE_OPTION_ID} 字元`
        )
      } else {
        if (seenPoIds.has(po.purchaseOptionId)) {
          pushIssue(
            issues,
            index,
            pid,
            `${prefix}.purchaseOptionId`,
            `重複的 purchaseOptionId: ${po.purchaseOptionId}`
          )
        }
        seenPoIds.add(po.purchaseOptionId)
      }
      if (!VALID_PO_TYPES.has(po?.type)) {
        pushIssue(
          issues,
          index,
          pid,
          `${prefix}.type`,
          `type 必須為 ${Array.from(VALID_PO_TYPES).join(' / ')}（目前不支援匯入 RENT）`
        )
      }
      if (!VALID_PO_STATES.has(po?.state)) {
        pushIssue(
          issues,
          index,
          pid,
          `${prefix}.state`,
          `state 必須為 ${Array.from(VALID_PO_STATES).join(' / ')}`
        )
      }
      if (typeof po?.legacyCompatible !== 'boolean') {
        pushIssue(
          issues,
          index,
          pid,
          `${prefix}.legacyCompatible`,
          'legacyCompatible 必須是 boolean'
        )
      } else if (po.legacyCompatible) {
        legacyCount++
      }
      if (!Array.isArray(po?.regions) || po.regions.length === 0) {
        pushIssue(issues, index, pid, `${prefix}.regions`, 'regions 必須是非空陣列')
      } else {
        const seenRegions = new Set<string>()
        po.regions.forEach((r: any, rIdx: number) => {
          const rPrefix = `${prefix}.regions[${rIdx}]`
          if (typeof r?.regionCode !== 'string' || r.regionCode.length === 0) {
            pushIssue(issues, index, pid, `${rPrefix}.regionCode`, 'regionCode 不可為空')
          } else {
            if (seenRegions.has(r.regionCode)) {
              pushIssue(
                issues,
                index,
                pid,
                `${rPrefix}.regionCode`,
                `重複的 regionCode: ${r.regionCode}`
              )
            }
            seenRegions.add(r.regionCode)
            if (validRegionCodes.size > 0 && !validRegionCodes.has(r.regionCode)) {
              pushIssue(
                issues,
                index,
                pid,
                `${rPrefix}.regionCode`,
                `Google 不支援的地區代碼: ${r.regionCode}`
              )
            }
          }
          if (!VALID_AVAILABILITY.has(r?.availability)) {
            pushIssue(
              issues,
              index,
              pid,
              `${rPrefix}.availability`,
              `availability 必須為 ${Array.from(VALID_AVAILABILITY).join(' / ')}`
            )
          }
          if (typeof r?.currencyCode !== 'string') {
            pushIssue(issues, index, pid, `${rPrefix}.currencyCode`, 'currencyCode 必須是字串')
          }
          if (typeof r?.units !== 'string') {
            pushIssue(issues, index, pid, `${rPrefix}.units`, 'units 必須是字串（整數部分）')
          }
          if (typeof r?.nanos !== 'number' || r.nanos < 0 || r.nanos >= 1_000_000_000) {
            pushIssue(
              issues,
              index,
              pid,
              `${rPrefix}.nanos`,
              'nanos 必須是 0–999,999,999 的整數'
            )
          }
        })
      }
    })
    if (legacyCount > 1) {
      pushIssue(
        issues,
        index,
        pid,
        'purchaseOptions',
        `最多只能有一個 legacyCompatible=true 的 PO，目前 ${legacyCount} 個`
      )
    }
  }
}

export async function validateImport(
  projectId: string,
  fileContent: string,
  existingProductIds: string[]
): Promise<GoogleImportPreview> {
  const issues: GoogleImportValidationIssue[] = []

  let parsed: any
  try {
    parsed = JSON.parse(fileContent)
  } catch (e: any) {
    return {
      valid: false,
      products: [],
      issues: [{ index: -1, field: '(file)', message: `JSON 解析失敗: ${e.message}` }]
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      valid: false,
      products: [],
      issues: [{ index: -1, field: '(root)', message: '檔案格式無效，必須為物件' }]
    }
  }

  if (parsed.formatVersion !== GOOGLE_EXPORT_FORMAT_VERSION) {
    return {
      valid: false,
      products: [],
      issues: [
        {
          index: -1,
          field: 'formatVersion',
          message: `不相容的 formatVersion: ${parsed.formatVersion}（僅支援 ${GOOGLE_EXPORT_FORMAT_VERSION}）`
        }
      ]
    }
  }

  if (!Array.isArray(parsed.products) || parsed.products.length === 0) {
    return {
      valid: false,
      formatVersion: parsed.formatVersion,
      exportedAt: parsed.exportedAt,
      packageName: parsed.packageName,
      products: [],
      issues: [{ index: -1, field: 'products', message: 'products 必須是非空陣列' }]
    }
  }

  // Fetch supported regions for validation. If the call fails, degrade
  // gracefully by skipping region-code checks rather than blocking import.
  let validRegionCodes = new Set<string>()
  try {
    const regions = await fetchSupportedRegions(projectId)
    validRegionCodes = new Set(regions.map((r) => r.regionCode))
  } catch {
    // Leave empty — validateProduct will skip regionCode membership check.
  }

  const seenProductIds = new Set<string>()
  const existingSet = new Set(existingProductIds)

  parsed.products.forEach((p: any, idx: number) => {
    validateProduct(p, idx, validRegionCodes, seenProductIds, existingSet, issues)
  })

  return {
    valid: issues.length === 0,
    formatVersion: parsed.formatVersion,
    exportedAt: parsed.exportedAt,
    packageName: parsed.packageName,
    products: parsed.products as ExportedGoogleProduct[],
    issues
  }
}

// Build the Google Play API purchaseOptions payload from an ExportedGoogleProduct.
// All POs are created as DRAFT regardless of the exported state — the user
// can review the import and then activate explicitly via the Detail page.
// This avoids publishing something broken by accident on import.
function buildPurchaseOptionsPayload(product: ExportedGoogleProduct): any[] {
  const payload: any[] = []
  for (const po of product.purchaseOptions) {
    if (po.type !== 'BUY') continue
    payload.push({
      purchaseOptionId: po.purchaseOptionId,
      state: 'DRAFT',
      buyOption: {
        legacyCompatible: po.legacyCompatible,
        multiQuantityEnabled: false
      },
      regionalPricingAndAvailabilityConfigs: po.regions.map((r) => ({
        regionCode: r.regionCode,
        availability: r.availability,
        price: {
          currencyCode: r.currencyCode,
          units: r.units,
          nanos: r.nanos
        }
      }))
    })
  }
  return payload
}

async function importSingleProduct(
  projectId: string,
  product: ExportedGoogleProduct,
  reportStep?: (phase: string) => void
): Promise<GoogleImportProductResult> {
  const result: GoogleImportProductResult = {
    productId: product.productId,
    created: false,
    stepErrors: [],
    skippedRegions: []
  }

  // Create the product via PATCH with full listings + POs.
  // Reuse the drop-and-retry pattern used by createOneTimeProduct so a few
  // regions Google rejects don't kill the whole import.
  reportStep?.(`${product.productId} · 建立商品中`)

  const listings = product.listings.map((l) => ({
    languageCode: l.languageCode,
    title: l.title,
    description: l.description
  }))

  const poPayload = buildPurchaseOptionsPayload(product)
  if (poPayload.length === 0) {
    result.stepErrors.push({
      step: 'create',
      error: '商品沒有可匯入的 BUY PO'
    })
    return result
  }

  const params = new URLSearchParams({
    allowMissing: 'true',
    updateMask: 'listings,purchaseOptions',
    'regionsVersion.version': REGIONS_VERSION
  })

  let workingPOs = poPayload
  const skipped: string[] = []
  let created = false
  let lastError = ''

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await googleRequest(
        projectId,
        `/onetimeproducts/${product.productId}?${params}`,
        {
          method: 'PATCH',
          body: {
            productId: product.productId,
            listings,
            purchaseOptions: workingPOs
          }
        }
      )
      created = true
      break
    } catch (e: any) {
      lastError = e?.message || String(e)
      const bad = parseProblematicRegions(lastError)
      // Filter to regions that actually appear in any PO — otherwise the
      // error is from a different cause and retrying won't help.
      const newBad = bad.filter((code) =>
        workingPOs.some((po) =>
          po.regionalPricingAndAvailabilityConfigs.some((c: any) => c.regionCode === code)
        )
      )
      if (newBad.length === 0) {
        result.stepErrors.push({ step: 'create', error: lastError })
        return result
      }
      skipped.push(...newBad)
      workingPOs = workingPOs.map((po) => ({
        ...po,
        regionalPricingAndAvailabilityConfigs: po.regionalPricingAndAvailabilityConfigs.filter(
          (c: any) => !newBad.includes(c.regionCode)
        )
      }))
    }
  }

  if (!created) {
    result.stepErrors.push({
      step: 'create',
      error: `重試超過上限，最後錯誤：${lastError}`
    })
    return result
  }

  result.created = true
  result.skippedRegions = [...new Set(skipped)]
  return result
}

export async function executeImport(
  projectId: string,
  products: ExportedGoogleProduct[],
  onProgress?: GoogleImportProgressCallback
): Promise<{ results: GoogleImportProductResult[] }> {
  const total = products.length
  const results: GoogleImportProductResult[] = []
  let done = 0

  onProgress?.(0, total, `匯入中 0/${total}`)

  await runWithConcurrency(products, IMPORT_CONCURRENCY, async (product) => {
    const reportStep = (phase: string): void => {
      onProgress?.(done, total, `${phase}（${done}/${total} 完成）`)
    }
    const res = await importSingleProduct(projectId, product, reportStep)
    results.push(res)
    done++
    onProgress?.(done, total, `匯入中 ${done}/${total}`)
  })

  results.sort((a, b) => a.productId.localeCompare(b.productId))
  return { results }
}
