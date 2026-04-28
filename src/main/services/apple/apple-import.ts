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
import { t } from '../../i18n'
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
    pushIssue(issues, index, undefined, '(root)', t('apple.import.validation.notObject'))
    return
  }

  // productId — normalize so all issues for the same product group consistently
  const rawPid = p.productId
  const pid = typeof rawPid === 'string' && rawPid.length > 0 ? rawPid : undefined

  if (!pid) {
    pushIssue(issues, index, undefined, 'productId', t('apple.import.validation.productIdEmpty'))
  } else if (!PRODUCT_ID_RE.test(pid)) {
    pushIssue(issues, index, pid, 'productId', t('apple.import.validation.productIdFormat'))
  } else if (pid.length > MAX_PRODUCT_ID) {
    pushIssue(
      issues,
      index,
      pid,
      'productId',
      t('apple.import.validation.productIdTooLong', { max: MAX_PRODUCT_ID })
    )
  } else {
    if (seenProductIds.has(pid)) {
      pushIssue(
        issues,
        index,
        pid,
        'productId',
        t('apple.import.validation.productIdDuplicateFile')
      )
    }
    if (existingProductIds.has(pid)) {
      pushIssue(issues, index, pid, 'productId', t('apple.import.validation.productIdExisting'))
    }
    seenProductIds.add(pid)
  }

  // referenceName
  if (typeof p.referenceName !== 'string' || p.referenceName.length === 0) {
    pushIssue(issues, index, pid, 'referenceName', t('apple.import.validation.refNameEmpty'))
  } else if (p.referenceName.length > MAX_REF_NAME) {
    pushIssue(
      issues,
      index,
      pid,
      'referenceName',
      t('apple.import.validation.refNameTooLong', { max: MAX_REF_NAME })
    )
  }

  // type
  if (!VALID_TYPES.has(p.type)) {
    pushIssue(
      issues,
      index,
      pid,
      'type',
      t('apple.import.validation.invalidType', { types: Array.from(VALID_TYPES).join(' / ') })
    )
  }

  // availability
  const av = p.availability
  if (!av || typeof av !== 'object') {
    pushIssue(
      issues,
      index,
      pid,
      'availability',
      t('apple.import.validation.availabilityNotObject')
    )
  } else {
    if (!Array.isArray(av.territories)) {
      pushIssue(
        issues,
        index,
        pid,
        'availability.territories',
        t('apple.import.validation.territoriesNotArray')
      )
    } else {
      for (const terr of av.territories) {
        if (typeof terr !== 'string') {
          pushIssue(
            issues,
            index,
            pid,
            'availability.territories',
            t('apple.import.validation.territoryNotString')
          )
          break
        }
        if (!validTerritoryIds.has(terr)) {
          pushIssue(
            issues,
            index,
            pid,
            'availability.territories',
            t('apple.import.validation.invalidTerritory', { territory: terr })
          )
        }
      }
    }
    if (typeof av.availableInNewTerritories !== 'boolean') {
      pushIssue(
        issues,
        index,
        pid,
        'availability.availableInNewTerritories',
        t('apple.import.validation.availInNewNotBoolean')
      )
    }
  }

  // priceSchedule (optional)
  if (p.priceSchedule !== undefined) {
    const ps = p.priceSchedule
    if (typeof ps !== 'object' || ps === null) {
      pushIssue(
        issues,
        index,
        pid,
        'priceSchedule',
        t('apple.import.validation.priceScheduleNotObject')
      )
    } else {
      if (typeof ps.baseTerritory !== 'string' || ps.baseTerritory.length === 0) {
        pushIssue(
          issues,
          index,
          pid,
          'priceSchedule.baseTerritory',
          t('apple.import.validation.baseTerritoryEmpty')
        )
      } else if (!validTerritoryIds.has(ps.baseTerritory)) {
        pushIssue(
          issues,
          index,
          pid,
          'priceSchedule.baseTerritory',
          t('apple.import.validation.invalidTerritory', { territory: ps.baseTerritory })
        )
      }
      if (typeof ps.basePrice !== 'string' || !PRICE_RE.test(ps.basePrice)) {
        pushIssue(
          issues,
          index,
          pid,
          'priceSchedule.basePrice',
          t('apple.import.validation.basePriceFormat')
        )
      }
      if (ps.customPrices !== undefined) {
        if (!Array.isArray(ps.customPrices)) {
          pushIssue(
            issues,
            index,
            pid,
            'priceSchedule.customPrices',
            t('apple.import.validation.customPricesNotArray')
          )
        } else {
          const seenTerritories = new Set<string>()
          ps.customPrices.forEach((cp: any, cpIdx: number) => {
            const prefix = `priceSchedule.customPrices[${cpIdx}]`
            if (typeof cp?.territory !== 'string' || cp.territory.length === 0) {
              pushIssue(
                issues,
                index,
                pid,
                `${prefix}.territory`,
                t('apple.import.validation.territoryEmpty')
              )
            } else {
              if (!validTerritoryIds.has(cp.territory)) {
                pushIssue(
                  issues,
                  index,
                  pid,
                  `${prefix}.territory`,
                  t('apple.import.validation.invalidTerritory', { territory: cp.territory })
                )
              }
              if (cp.territory === ps.baseTerritory) {
                pushIssue(
                  issues,
                  index,
                  pid,
                  `${prefix}.territory`,
                  t('apple.import.validation.customPriceTerritoryBase')
                )
              }
              if (seenTerritories.has(cp.territory)) {
                pushIssue(
                  issues,
                  index,
                  pid,
                  `${prefix}.territory`,
                  t('apple.import.validation.customPriceDup', { territory: cp.territory })
                )
              }
              seenTerritories.add(cp.territory)
            }
            if (typeof cp?.price !== 'string' || !PRICE_RE.test(cp.price)) {
              pushIssue(
                issues,
                index,
                pid,
                `${prefix}.price`,
                t('apple.import.validation.priceNotString')
              )
            }
          })
        }
      }
    }
  }

  // localizations (optional)
  if (p.localizations !== undefined) {
    if (!Array.isArray(p.localizations)) {
      pushIssue(
        issues,
        index,
        pid,
        'localizations',
        t('apple.import.validation.localizationsNotArray')
      )
    } else {
      const seenLocales = new Set<string>()
      p.localizations.forEach((loc: any, lIdx: number) => {
        const prefix = `localizations[${lIdx}]`
        if (typeof loc?.locale !== 'string' || loc.locale.length === 0) {
          pushIssue(
            issues,
            index,
            pid,
            `${prefix}.locale`,
            t('apple.import.validation.localeEmpty')
          )
        } else {
          if (seenLocales.has(loc.locale)) {
            pushIssue(
              issues,
              index,
              pid,
              `${prefix}.locale`,
              t('apple.import.validation.localeDuplicate', { locale: loc.locale })
            )
          }
          seenLocales.add(loc.locale)
        }
        if (typeof loc?.name !== 'string' || loc.name.length === 0) {
          pushIssue(issues, index, pid, `${prefix}.name`, t('apple.import.validation.nameEmpty'))
        } else if (loc.name.length > MAX_LOC_NAME) {
          pushIssue(
            issues,
            index,
            pid,
            `${prefix}.name`,
            t('apple.import.validation.nameTooLong', { max: MAX_LOC_NAME })
          )
        }
        if (loc?.description !== undefined) {
          if (typeof loc.description !== 'string') {
            pushIssue(
              issues,
              index,
              pid,
              `${prefix}.description`,
              t('apple.import.validation.descriptionNotString')
            )
          } else if (loc.description.length > MAX_LOC_DESC) {
            pushIssue(
              issues,
              index,
              pid,
              `${prefix}.description`,
              t('apple.import.validation.descriptionTooLong', { max: MAX_LOC_DESC })
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
      issues: [
        {
          index: -1,
          field: '(file)',
          message: t('apple.import.validation.jsonParseFail', { error: e.message })
        }
      ]
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      valid: false,
      products: [],
      issues: [{ index: -1, field: '(root)', message: t('apple.import.validation.rootNotObject') }]
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
          message: t('apple.import.validation.formatVersionMismatch', {
            got: parsed.formatVersion,
            expected: EXPORT_FORMAT_VERSION
          })
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
      issues: [
        { index: -1, field: 'products', message: t('apple.import.validation.productsNotArray') }
      ]
    }
  }

  // Fetch Apple territories for validation
  let validTerritoryIds: Set<string>
  let territoryCurrencyMap: Record<string, string>
  try {
    const territories = await getAllTerritories(projectId)
    validTerritoryIds = new Set(territories.map((terr) => terr.id))
    territoryCurrencyMap = Object.fromEntries(territories.map((terr) => [terr.id, terr.currency]))
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
          message: t('apple.import.validation.territoryListFail', { error: e.message })
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
  reportStep?.(t('apple.import.step.creating', { productId: product.productId }))
  let iapId: string
  try {
    const created = await createInAppPurchase(projectId, {
      productId: product.productId,
      referenceName: product.referenceName,
      inAppPurchaseType: product.type as
        | 'CONSUMABLE'
        | 'NON_CONSUMABLE'
        | 'NON_RENEWING_SUBSCRIPTION',
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
  reportStep?.(t('apple.import.step.availability', { productId: product.productId }))
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
      reportStep?.(t('apple.import.step.priceLookup', { productId: product.productId }))
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
          error: t('apple.import.stepError.pricePointNotFound', {
            territory: ps.baseTerritory,
            price: ps.basePrice
          })
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
            error: t('apple.import.stepError.pricePointNotFound', {
              territory: cp.territory,
              price: cp.price
            })
          })
        } else {
          resolvedIds.push(match.id)
        }
      }

      // Only set schedule if base resolved
      if (baseMatch) {
        reportStep?.(t('apple.import.step.priceSet', { productId: product.productId }))
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
      reportStep?.(
        t('apple.import.step.localization', { productId: product.productId, locale: loc.locale })
      )
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
  if (!creds.apple?.appId) throw new Error(t('credentials.apple.missingAppId'))
  const appId = creds.apple.appId

  const total = products.length
  const results: ImportProductResult[] = []
  let done = 0

  onProgress?.(0, total, t('apple.import.starting', { total }))

  await runWithConcurrency(products, IMPORT_CONCURRENCY, async (product) => {
    const reportStep = (phase: string): void => {
      onProgress?.(done, total, t('apple.import.progressPhase', { phase, done, total }))
    }
    const res = await importSingleProduct(projectId, appId, product, reportStep)
    results.push(res)
    done++
    onProgress?.(done, total, t('apple.import.progress', { done, total }))
  })

  results.sort((a, b) => a.productId.localeCompare(b.productId))
  return { results }
}
