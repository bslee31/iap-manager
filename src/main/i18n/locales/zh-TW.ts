// Main-process Traditional Chinese messages. Sibling dictionary to the
// renderer's zh-TW.ts; keep keys here scoped to strings that originate
// from the main process (errors thrown out to IPC, validation messages
// pushed through ImportPreview, sync/export/import phase texts).
//
// Group by source feature: credentials / project / apple / google.

const zhTW = {
  credentials: {
    encryptionUnavailable: '系統加密功能不可用',
    apple: {
      notSet: 'Apple 憑證未設定',
      missingAppId: '未設定 App ID'
    },
    google: {
      notSet: 'Google 憑證未設定'
    },
    test: {
      appleSuccess: 'Apple API 連線成功',
      googleSuccess: 'Google API 連線成功'
    }
  },

  project: {
    notFound: '專案不存在'
  },

  apple: {
    api: {
      invalidUrl: '無效的 URL：{path}',
      forbiddenHost: '拒絕對非 Apple API 的網址發送請求：{host}',
      apiError: 'Apple API 錯誤 ({status})'
    },
    iap: {
      regionListFail: '無法取得地區列表: {error}',
      noPriceSet: '尚未設定價格',
      missingBaseTerritory: '找不到基準地區'
    },
    sync: {
      fetchingList: '取得商品列表...',
      fetched: '已取得 {count} 個商品...'
    },
    export: {
      noProducts: '沒有可匯出的商品',
      title: '匯出 Apple IAP',
      starting: '開始匯出...',
      progress: '匯出中 {done}/{total}'
    },
    import: {
      noProducts: '沒有可匯入的商品',
      starting: '匯入中 0/{total}',
      progress: '匯入中 {done}/{total}',
      progressPhase: '{phase}（{done}/{total} 完成）',
      step: {
        creating: '{productId} · 建立商品中',
        availability: '{productId} · 設定 Availability',
        priceLookup: '{productId} · 查詢價格點',
        priceSet: '{productId} · 設定價格',
        localization: '{productId} · 建立本地化 {locale}'
      },
      stepError: {
        pricePointNotFound: '{territory} 找不到 {price} 對應的 pricePoint'
      },
      validation: {
        notObject: '商品必須是物件',
        productIdEmpty: 'productId 不可為空',
        productIdFormat: 'productId 只能包含英數、. _',
        productIdTooLong: 'productId 超過 {max} 字元',
        productIdDuplicateFile: '檔案內有重複的 productId',
        productIdExisting: '已存在於目前專案中',
        refNameEmpty: 'referenceName 不可為空',
        refNameTooLong: 'referenceName 超過 {max} 字元',
        invalidType: 'type 必須為 {types}',
        availabilityNotObject: 'availability 必須是物件',
        territoriesNotArray: 'territories 必須是陣列',
        territoryNotString: '每個地區代碼必須為字串',
        invalidTerritory: '無效的地區代碼: {territory}',
        availInNewNotBoolean: 'availableInNewTerritories 必須是 boolean',
        priceScheduleNotObject: 'priceSchedule 必須是物件',
        baseTerritoryEmpty: 'baseTerritory 不可為空',
        basePriceFormat: 'basePrice 必須是數字字串（例：0.99）',
        customPricesNotArray: 'customPrices 必須是陣列',
        territoryEmpty: 'territory 不可為空',
        customPriceTerritoryBase: 'customPrices 不可包含 baseTerritory',
        customPriceDup: 'customPrices 中出現重複地區: {territory}',
        priceNotString: 'price 必須是數字字串',
        localizationsNotArray: 'localizations 必須是陣列',
        localeEmpty: 'locale 不可為空',
        localeDuplicate: '重複的 locale: {locale}',
        nameEmpty: 'name 不可為空',
        nameTooLong: 'name 超過 {max} 字元',
        descriptionNotString: 'description 必須是字串',
        descriptionTooLong: 'description 超過 {max} 字元',
        jsonParseFail: 'JSON 解析失敗: {error}',
        rootNotObject: '檔案格式無效，必須為物件',
        formatVersionMismatch: '不相容的 formatVersion: {got}（僅支援 {expected}）',
        productsNotArray: 'products 必須是非空陣列',
        territoryListFail: '無法取得地區清單以驗證: {error}'
      }
    }
  },

  google: {
    api: {
      invalidUrl: '無效的 URL：{path}',
      forbiddenHost: '拒絕對非 Google Play API 的網址發送請求：{host}',
      apiError: 'Google API 錯誤 ({status})'
    },
    edits: {
      noEditId: 'Google Play Edits API 未回傳 edit id',
      noDefaultLanguage: 'Google Play 尚未設定 App 預設語言'
    },
    sync: {
      syncing: '正在從 Google Play 同步...',
      fetched: '已取得 {count} 個商品'
    },
    products: {
      poNotFound: '找不到 Purchase Option ID',
      poNotFoundColon: '找不到 Purchase Option：{poId}',
      poExists: 'Purchase Option 已存在：{poId}',
      primaryNonBuy: '只有 BUY 型方案可以設為主方案',
      retryExhausted: '重試超過上限，Google 仍回報地區錯誤。最後錯誤：{error}'
    },
    create: {
      needLanguage: '請選擇語言',
      needRegion: '請選擇基準國家',
      needCurrency: '請選擇基準幣別',
      needPoId: '請填寫 Purchase Option ID'
    },
    export: {
      noProducts: '沒有可匯出的商品',
      title: '匯出 Google One-time Products',
      starting: '開始匯出...',
      progress: '匯出中 {done}/{total}'
    },
    import: {
      starting: '匯入中 0/{total}',
      progress: '匯入中 {done}/{total}',
      progressPhase: '{phase}（{done}/{total} 完成）',
      step: {
        creating: '{productId} · 建立商品中'
      },
      retryExhausted: '重試超過上限，最後錯誤：{error}',
      noBuyPo: '商品沒有可匯入的 BUY PO',
      regionListFail: '無法載入 Google 支援地區列表，無法驗證匯入內容：{error}',
      validation: {
        notObject: '商品必須是物件',
        productIdEmpty: 'productId 不可為空',
        productIdFormat: 'productId 必須以小寫英數開頭，只能包含小寫英數、. _',
        productIdTooLong: 'productId 超過 {max} 字元',
        productIdDuplicateFile: '檔案內有重複的 productId',
        productIdExisting: '已存在於目前專案中',
        listingsNotArray: 'listings 必須是非空陣列',
        languageCodeEmpty: 'languageCode 不可為空',
        languageCodeDup: '重複的 languageCode: {code}',
        titleEmpty: 'title 不可為空',
        titleTooLong: 'title 超過 {max} 字元',
        descriptionEmpty: 'description 不可為空',
        descriptionTooLong: 'description 超過 {max} 字元',
        purchaseOptionsNotArray: 'purchaseOptions 必須是非空陣列',
        poIdEmpty: 'purchaseOptionId 不可為空',
        poIdFormat: 'purchaseOptionId 必須以小寫英數開頭，只能包含小寫英數和 -（不可有 _ 或 .）',
        poIdTooLong: 'purchaseOptionId 超過 {max} 字元',
        poIdDup: '重複的 purchaseOptionId: {id}',
        poTypeInvalid: 'type 必須為 {types}（目前不支援匯入 RENT）',
        poStateInvalid: 'state 必須為 {states}',
        legacyCompatibleNotBoolean: 'legacyCompatible 必須是 boolean',
        regionsNotArray: 'regions 必須是非空陣列',
        regionCodeEmpty: 'regionCode 不可為空',
        regionCodeDup: '重複的 regionCode: {code}',
        regionUnsupported: 'Google 不支援的地區代碼: {code}',
        availabilityInvalid: 'availability 必須為 {values}',
        currencyCodeNotString: 'currencyCode 必須是字串',
        unitsNotString: 'units 必須是字串（整數部分）',
        nanosOutOfRange: 'nanos 必須是 0–999,999,999 的整數',
        legacyCompatibleTooMany: '最多只能有一個 legacyCompatible=true 的 PO，目前 {count} 個',
        jsonParseFail: 'JSON 解析失敗: {error}',
        rootNotObject: '檔案格式無效，必須為物件',
        formatVersionMismatch: '不相容的 formatVersion: {got}（僅支援 {expected}）',
        productsNotArray: 'products 必須是非空陣列'
      }
    }
  }
}

export default zhTW
export type Messages = typeof zhTW
