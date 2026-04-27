import {
  createInAppPurchase,
  updateIapAvailability,
  getAllTerritories,
  getIapPricePoints,
  setIapPriceScheduleBatch,
  createIapLocalization
} from './apple-iap'
import { loadCredentials } from '../credential-store'
import { runWithConcurrency, IMPORT_CONCURRENCY } from '../concurrency'
import {
  EXPORT_FORMAT_VERSION,
  type ExportedProduct,
  type ImportPreview,
  type ImportValidationIssue,
  type ImportProductResult,
  type ImportStepError
} from './apple-types'

const VALID_TYPES = new Set(['CONSUMABLE', 'NON_CONSUMABLE', 'NON_RENEWING_SUBSCRIPTION'])
const PRODUCT_ID_RE = /^[a-zA-Z0-9._]+$/
const PRICE_RE = /^\d+(\.\d+)?$/
const MAX_PRODUCT_ID = 100
const MAX_REF_NAME = 64
const MAX_LOC_NAME = 35
const MAX_LOC_DESC = 55

export type ImportProgressCallback = (current: number, total: number, phase: string) => void

function pushIssue(
  issues: ImportValidationIssue[],
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
  validTerritoryIds: Set<string>,
  seenProductIds: Set<string>,
  existingProductIds: Set<string>,
  issues: ImportValidationIssue[]
): void {
  if (typeof p !== 'object' || p === null) {
    pushIssue(issues, index, undefined, '(root)', '商品必須是物件')
    return
  }

  // productId — normalize so all issues for the same product group consistently
  const rawPid = p.productId
  const pid = typeof rawPid === 'string' && rawPid.length > 0 ? rawPid : undefined

  if (!pid) {
    pushIssue(issues, index, undefined, 'productId', 'productId 不可為空')
  } else if (!PRODUCT_ID_RE.test(pid)) {
    pushIssue(issues, index, pid, 'productId', 'productId 只能包含英數、. _')
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

  // referenceName
  if (typeof p.referenceName !== 'string' || p.referenceName.length === 0) {
    pushIssue(issues, index, pid, 'referenceName', 'referenceName 不可為空')
  } else if (p.referenceName.length > MAX_REF_NAME) {
    pushIssue(issues, index, pid, 'referenceName', `referenceName 超過 ${MAX_REF_NAME} 字元`)
  }

  // type
  if (!VALID_TYPES.has(p.type)) {
    pushIssue(
      issues,
      index,
      pid,
      'type',
      `type 必須為 ${Array.from(VALID_TYPES).join(' / ')}`
    )
  }

  // availability
  const av = p.availability
  if (!av || typeof av !== 'object') {
    pushIssue(issues, index, pid, 'availability', 'availability 必須是物件')
  } else {
    if (!Array.isArray(av.territories)) {
      pushIssue(issues, index, pid, 'availability.territories', 'territories 必須是陣列')
    } else {
      for (const t of av.territories) {
        if (typeof t !== 'string') {
          pushIssue(issues, index, pid, 'availability.territories', '每個地區代碼必須為字串')
          break
        }
        if (!validTerritoryIds.has(t)) {
          pushIssue(issues, index, pid, 'availability.territories', `無效的地區代碼: ${t}`)
        }
      }
    }
    if (typeof av.availableInNewTerritories !== 'boolean') {
      pushIssue(
        issues,
        index,
        pid,
        'availability.availableInNewTerritories',
        'availableInNewTerritories 必須是 boolean'
      )
    }
  }

  // priceSchedule (optional)
  if (p.priceSchedule !== undefined) {
    const ps = p.priceSchedule
    if (typeof ps !== 'object' || ps === null) {
      pushIssue(issues, index, pid, 'priceSchedule', 'priceSchedule 必須是物件')
    } else {
      if (typeof ps.baseTerritory !== 'string' || ps.baseTerritory.length === 0) {
        pushIssue(issues, index, pid, 'priceSchedule.baseTerritory', 'baseTerritory 不可為空')
      } else if (!validTerritoryIds.has(ps.baseTerritory)) {
        pushIssue(
          issues,
          index,
          pid,
          'priceSchedule.baseTerritory',
          `無效的地區代碼: ${ps.baseTerritory}`
        )
      }
      if (typeof ps.basePrice !== 'string' || !PRICE_RE.test(ps.basePrice)) {
        pushIssue(
          issues,
          index,
          pid,
          'priceSchedule.basePrice',
          'basePrice 必須是數字字串（例：0.99）'
        )
      }
      if (ps.customPrices !== undefined) {
        if (!Array.isArray(ps.customPrices)) {
          pushIssue(issues, index, pid, 'priceSchedule.customPrices', 'customPrices 必須是陣列')
        } else {
          const seenTerritories = new Set<string>()
          ps.customPrices.forEach((cp: any, cpIdx: number) => {
            const prefix = `priceSchedule.customPrices[${cpIdx}]`
            if (typeof cp?.territory !== 'string' || cp.territory.length === 0) {
              pushIssue(issues, index, pid, `${prefix}.territory`, 'territory 不可為空')
            } else {
              if (!validTerritoryIds.has(cp.territory)) {
                pushIssue(
                  issues,
                  index,
                  pid,
                  `${prefix}.territory`,
                  `無效的地區代碼: ${cp.territory}`
                )
              }
              if (cp.territory === ps.baseTerritory) {
                pushIssue(
                  issues,
                  index,
                  pid,
                  `${prefix}.territory`,
                  'customPrices 不可包含 baseTerritory'
                )
              }
              if (seenTerritories.has(cp.territory)) {
                pushIssue(
                  issues,
                  index,
                  pid,
                  `${prefix}.territory`,
                  `customPrices 中出現重複地區: ${cp.territory}`
                )
              }
              seenTerritories.add(cp.territory)
            }
            if (typeof cp?.price !== 'string' || !PRICE_RE.test(cp.price)) {
              pushIssue(issues, index, pid, `${prefix}.price`, 'price 必須是數字字串')
            }
          })
        }
      }
    }
  }

  // localizations (optional)
  if (p.localizations !== undefined) {
    if (!Array.isArray(p.localizations)) {
      pushIssue(issues, index, pid, 'localizations', 'localizations 必須是陣列')
    } else {
      const seenLocales = new Set<string>()
      p.localizations.forEach((loc: any, lIdx: number) => {
        const prefix = `localizations[${lIdx}]`
        if (typeof loc?.locale !== 'string' || loc.locale.length === 0) {
          pushIssue(issues, index, pid, `${prefix}.locale`, 'locale 不可為空')
        } else {
          if (seenLocales.has(loc.locale)) {
            pushIssue(issues, index, pid, `${prefix}.locale`, `重複的 locale: ${loc.locale}`)
          }
          seenLocales.add(loc.locale)
        }
        if (typeof loc?.name !== 'string' || loc.name.length === 0) {
          pushIssue(issues, index, pid, `${prefix}.name`, 'name 不可為空')
        } else if (loc.name.length > MAX_LOC_NAME) {
          pushIssue(issues, index, pid, `${prefix}.name`, `name 超過 ${MAX_LOC_NAME} 字元`)
        }
        if (loc?.description !== undefined) {
          if (typeof loc.description !== 'string') {
            pushIssue(issues, index, pid, `${prefix}.description`, 'description 必須是字串')
          } else if (loc.description.length > MAX_LOC_DESC) {
            pushIssue(
              issues,
              index,
              pid,
              `${prefix}.description`,
              `description 超過 ${MAX_LOC_DESC} 字元`
            )
          }
        }
      })
    }
  }
}

export async function validateImport(
  projectId: string,
  fileContent: string,
  existingProductIds: string[]
): Promise<ImportPreview> {
  const issues: ImportValidationIssue[] = []

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

  if (parsed.formatVersion !== EXPORT_FORMAT_VERSION) {
    return {
      valid: false,
      products: [],
      issues: [
        {
          index: -1,
          field: 'formatVersion',
          message: `不相容的 formatVersion: ${parsed.formatVersion}（僅支援 ${EXPORT_FORMAT_VERSION}）`
        }
      ]
    }
  }

  if (!Array.isArray(parsed.products) || parsed.products.length === 0) {
    return {
      valid: false,
      formatVersion: parsed.formatVersion,
      exportedAt: parsed.exportedAt,
      appId: parsed.appId,
      products: [],
      issues: [{ index: -1, field: 'products', message: 'products 必須是非空陣列' }]
    }
  }

  // Fetch Apple territories for validation
  let validTerritoryIds: Set<string>
  let territoryCurrencyMap: Record<string, string> = {}
  try {
    const territories = await getAllTerritories(projectId)
    validTerritoryIds = new Set(territories.map((t) => t.id))
    territoryCurrencyMap = Object.fromEntries(territories.map((t) => [t.id, t.currency]))
  } catch (e: any) {
    return {
      valid: false,
      formatVersion: parsed.formatVersion,
      exportedAt: parsed.exportedAt,
      appId: parsed.appId,
      products: [],
      issues: [
        {
          index: -1,
          field: '(territories)',
          message: `無法取得地區清單以驗證: ${e.message}`
        }
      ]
    }
  }

  const seenProductIds = new Set<string>()
  const existingSet = new Set(existingProductIds)

  parsed.products.forEach((p: any, idx: number) => {
    validateProduct(p, idx, validTerritoryIds, seenProductIds, existingSet, issues)
  })

  return {
    valid: issues.length === 0,
    formatVersion: parsed.formatVersion,
    exportedAt: parsed.exportedAt,
    appId: parsed.appId,
    products: parsed.products as ExportedProduct[],
    issues,
    territoryCurrencyMap
  }
}

async function importSingleProduct(
  projectId: string,
  appId: string,
  product: ExportedProduct,
  reportStep?: (phase: string) => void
): Promise<ImportProductResult> {
  const stepErrors: ImportStepError[] = []
  const result: ImportProductResult = {
    productId: product.productId,
    referenceName: product.referenceName,
    created: false,
    stepErrors,
    availabilityApplied: false,
    priceApplied: false
  }

  // Step 1: Create product
  reportStep?.(`${product.productId} · 建立商品中`)
  let iapId: string
  try {
    const created = await createInAppPurchase(projectId, {
      productId: product.productId,
      referenceName: product.referenceName,
      inAppPurchaseType: product.type as 'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION',
      appId
    })
    iapId = created.id
    result.iapId = iapId
    result.created = true
    result.createdState = created.attributes?.state
  } catch (e: any) {
    stepErrors.push({ step: 'create', error: e.message || String(e) })
    return result
  }

  // Step 2: Availability
  reportStep?.(`${product.productId} · 設定 Availability`)
  try {
    await updateIapAvailability(
      projectId,
      iapId,
      product.availability.territories,
      product.availability.availableInNewTerritories
    )
    result.availabilityApplied = true
  } catch (e: any) {
    stepErrors.push({ step: 'availability', error: e.message || String(e) })
  }

  // Step 3: Price schedule
  if (product.priceSchedule) {
    const ps = product.priceSchedule
    try {
      reportStep?.(`${product.productId} · 查詢價格點`)
      // Fetch price points for base + each custom territory in parallel
      const territoriesToResolve = [
        ps.baseTerritory,
        ...(ps.customPrices?.map((cp) => cp.territory) ?? [])
      ]

      const pointsByTerritory = new Map<string, { price: string; id: string }[]>()
      await Promise.all(
        territoriesToResolve.map(async (terr) => {
          const points = await getIapPricePoints(projectId, iapId, terr)
          pointsByTerritory.set(
            terr,
            points.map((pt) => ({ price: pt.customerPrice, id: pt.id }))
          )
        })
      )

      // Resolve pricePointIds; collect per-territory failures but keep any valid ones
      const resolvedIds: string[] = []

      const basePoints = pointsByTerritory.get(ps.baseTerritory) ?? []
      const baseMatch = basePoints.find((pt) => pt.price === ps.basePrice)
      if (!baseMatch) {
        stepErrors.push({
          step: 'price',
          target: ps.baseTerritory,
          error: `${ps.baseTerritory} 找不到 ${ps.basePrice} 對應的 pricePoint`
        })
      } else {
        resolvedIds.push(baseMatch.id)
      }

      for (const cp of ps.customPrices ?? []) {
        const points = pointsByTerritory.get(cp.territory) ?? []
        const match = points.find((pt) => pt.price === cp.price)
        if (!match) {
          stepErrors.push({
            step: 'customPrice',
            target: cp.territory,
            error: `${cp.territory} 找不到 ${cp.price} 對應的 pricePoint`
          })
        } else {
          resolvedIds.push(match.id)
        }
      }

      // Only set schedule if base resolved
      if (baseMatch) {
        reportStep?.(`${product.productId} · 設定價格`)
        await setIapPriceScheduleBatch(projectId, iapId, ps.baseTerritory, resolvedIds)
        result.priceApplied = true
      }
    } catch (e: any) {
      stepErrors.push({ step: 'price', error: e.message || String(e) })
    }
  }

  // Step 4: Localizations
  if (product.localizations) {
    for (const loc of product.localizations) {
      reportStep?.(`${product.productId} · 建立本地化 ${loc.locale}`)
      try {
        await createIapLocalization(projectId, iapId, {
          locale: loc.locale,
          name: loc.name,
          description: loc.description
        })
      } catch (e: any) {
        stepErrors.push({
          step: 'localization',
          target: loc.locale,
          error: e.message || String(e)
        })
      }
    }
  }

  return result
}

export async function executeImport(
  projectId: string,
  products: ExportedProduct[],
  onProgress?: ImportProgressCallback
): Promise<{ results: ImportProductResult[] }> {
  const creds = loadCredentials(projectId)
  if (!creds.apple?.appId) throw new Error('未設定 App ID')
  const appId = creds.apple.appId

  const total = products.length
  const results: ImportProductResult[] = []
  let done = 0

  onProgress?.(0, total, `匯入中 0/${total}`)

  await runWithConcurrency(products, IMPORT_CONCURRENCY, async (product) => {
    const reportStep = (phase: string): void => {
      onProgress?.(done, total, `${phase}（${done}/${total} 完成）`)
    }
    const res = await importSingleProduct(projectId, appId, product, reportStep)
    results.push(res)
    done++
    onProgress?.(done, total, `匯入中 ${done}/${total}`)
  })

  results.sort((a, b) => a.productId.localeCompare(b.productId))
  return { results }
}
