// Traditional Chinese messages. Keep keys flat-ish (max 3 levels deep) so
// callers stay readable: t('apple.detail.priceSchedule'). Group by feature
// (app / common / sidebar / project / apple / google / credentials), with
// enums (state / type / availability) under each feature's own namespace
// so dynamic lookups read as t(`apple.state.${state}`).
//
// When a new locale is added (e.g. en-US.ts), keep the same shape so the
// generated I18nMessages type catches missing keys at compile time.

const zhTW = {
  app: {
    title: 'IAP 管理工具'
  },

  common: {
    save: '儲存',
    cancel: '取消',
    confirm: '確認',
    delete: '刪除',
    edit: '編輯',
    create: '建立',
    close: '關閉',
    loading: '載入中...',
    saving: '儲存中...',
    saveChanges: '儲存變更',
    reload: '重新載入',
    success: '操作成功',
    error: '發生錯誤'
  },

  sidebar: {
    settings: '設定',
    newProject: '新增專案'
  },

  project: {
    list: {
      title: '專案列表',
      empty: '尚未建立任何專案',
      firstProject: '建立第一個專案',
      dragHandle: '拖曳排序'
    },
    create: '新增專案',
    edit: '編輯專案',
    form: {
      name: '專案名稱',
      namePlaceholder: '例：我的 App',
      description: '專案描述',
      descPlaceholder: '選填'
    },
    deleteConfirm: '確定要刪除「{name}」嗎？此操作無法復原。',
    toast: {
      created: '專案已建立',
      updated: '專案已更新',
      deleted: '專案已刪除'
    },
    tabs: {
      apple: 'Apple In-App Purchases',
      google: 'Google One-time products',
      credentials: '憑證設定'
    }
  },

  settings: {
    title: '設定',
    version: '應用程式版本',
    dataLocation: '資料儲存位置'
  },

  apple: {
    toolbar: {
      sync: '同步商品',
      export: '匯出',
      import: '匯入',
      searchPlaceholder: '搜尋 Product ID / Name...',
      create: '+ 新增商品',
      productCount: '{count} 個商品',
      productCountFiltered: '{filtered} / {total} 個商品'
    },
    batch: {
      selected: '已選 {count} 項',
      clearSelection: '取消選取',
      syncPrice: '重整 Price',
      syncAvailability: '重整 Availability',
      activate: '批次上架',
      deactivate: '批次下架',
      confirmActivate: '確定要上架選取的 {count} 個商品嗎？',
      confirmDeactivate: '確定要下架選取的 {count} 個商品嗎？',
      processingActivate: '正在批次上架...',
      processingDeactivate: '正在批次下架...',
      activateSuccess: '成功上架 {count} 項',
      deactivateSuccess: '成功下架 {count} 項',
      failedItems: '失敗 {count} 項\n{details}',
      opFailed: '操作失敗'
    },
    filter: {
      all: '全部 {count}'
    },
    state: {
      APPROVED: '已核准',
      DEVELOPER_ACTION_NEEDED: '需開發者處理',
      DEVELOPER_REMOVED_FROM_SALE: '已下架',
      IN_REVIEW: '審核中',
      MISSING_METADATA: '缺少資料',
      PENDING_BINARY_UPLOAD: '待上傳',
      PROCESSING_CONTENT: '處理中',
      READY_TO_SUBMIT: '準備提交',
      REJECTED: '已拒絕',
      REMOVED_FROM_SALE: '已下架',
      WAITING_FOR_REVIEW: '等待審核',
      WAITING_FOR_UPLOAD: '待上傳'
    },
    type: {
      CONSUMABLE: '消耗型',
      NON_CONSUMABLE: '非消耗型',
      NON_RENEWING_SUBSCRIPTION: '非續訂型訂閱'
    },
    table: {
      territoryCount: '{count} 個地區',
      noTerritory: '無'
    },
    empty: {
      noProducts: '尚無商品資料',
      noProductsHint: '請先設定 Apple 憑證，然後點擊「同步商品」',
      filteredEmpty: '此狀態下沒有商品'
    },
    progress: {
      connecting: '正在連線...',
      syncingPrice: '重整 Price... {current}/{total}',
      syncingAvail: '重整 Availability... {current}/{total}',
      exportPreparing: '準備匯出...'
    },
    toast: {
      syncSuccess: '同步完成，共 {count} 個商品',
      syncFail: '同步失敗',
      syncedPrice: '已重整 {count} 個商品的價格',
      syncedAvail: '已重整 {count} 個商品的 Availability',
      exportEmpty: '沒有可匯出的商品，請先同步',
      exportFail: '匯出失敗',
      exportPartial: '已匯出 {exported}/{total}，{failed} 項失敗\n{details}',
      exportSuccess: '匯出完成：{count} 個商品',
      createFillRequired: '請填寫商品 ID 和名稱',
      createSuccess: '商品已建立',
      createFail: '建立失敗'
    },
    create: {
      title: '新增 Apple IAP',
      typeLabel: '類型',
      productIdPlaceholder: '例：com.example.coins100',
      refNamePlaceholder: '例：100 金幣'
    },
    detail: {
      tabs: {
        info: 'Info',
        availability: 'Availability',
        price: 'Price Schedule',
        localization: 'Localization'
      },
      info: {
        idLockedHint: 'Product ID 建立後無法修改',
        notEditable: '此狀態（{state}）下 Apple 不允許修改',
        refNameHint: 'App Store Connect 內部顯示名稱，不影響使用者看到的內容',
        toast: {
          updateSuccess: 'Reference Name 已更新',
          updateFail: '更新失敗'
        }
      },
      availability: {
        loadFail: '載入 Availability 失敗',
        title: 'Country or Region Availability ({count})',
        searchPlaceholder: '搜尋地區...',
        selectedHint: '已選擇 {count} 個地區',
        selectAll: 'Select All',
        deselectAll: 'Deselect All',
        newTerritoriesHint:
          'Make your in-app purchase automatically available in all future App Store countries or regions.',
        saveButton: '儲存 Availability',
        toast: {
          updateSuccess: 'Availability 已更新',
          updateFail: '更新失敗'
        }
      },
      price: {
        adjustBase: '調整基準定價',
        baseRegion: '基準地區',
        priceLabel: '價格',
        baseRegionPlaceholder: '選擇基準地區...',
        pricePlaceholder: '選擇價格...',
        loadingPricePoints: '載入價格選項中...',
        saveButton: '儲存價格',
        autoConvertHint: 'Apple 會依所選價格點自動換算其他地區。',
        regionPrices: 'Country or Region Prices',
        searchPlaceholder: '搜尋地區...',
        baseLabel: 'Base Country or Region: {region} ({currency}) - {price}',
        onlyAvailable: '只顯示已上架地區',
        loading: '載入地區價格中...',
        noMatch: '找不到符合的地區',
        noPrices: '尚未設定價格',
        editTitle: '修改價格 — {region} ({currency})',
        editTooltip: '修改價格',
        toast: {
          missingPricePoint: '請選擇價格',
          updateSuccess: '價格已更新',
          updateRegionSuccess: '{region} 價格已更新',
          updateFail: '更新失敗'
        }
      },
      localization: {
        langCount: '{count} 個語言',
        addLang: '+ 新增語言',
        empty: '尚未新增任何本地化資料',
        createTitle: '新增本地化',
        editTitle: '編輯本地化',
        localePlaceholder: '請選擇語言...',
        namePlaceholder: '商品名稱',
        descPlaceholder: '商品描述（選填）',
        deleteConfirm: '確定要刪除 {locale} 的本地化資料嗎？',
        toast: {
          fillRequired: '請填寫 Locale 和 Name',
          createSuccess: '已新增',
          createFail: '新增失敗',
          updateSuccess: '已更新',
          updateFail: '更新失敗',
          deleteSuccess: '已刪除',
          deleteFail: '刪除失敗'
        }
      }
    },
    import: {
      header: {
        validating: '驗證檔案中...',
        validationError: '匯入檔案有問題',
        preview: '確認匯入',
        importing: '匯入中',
        done: '匯入結果'
      },
      validating: '讀取並驗證檔案中...',
      issuesIntro: '發現 {issues} 個問題（{products} 筆商品），請修正後重新匯入：',
      productsIntro: '將匯入 {count} 個商品：',
      importingHint: '匯入過程請勿關閉視窗',
      stats: {
        fullSuccess: '完全成功',
        partial: '部分成功',
        failed: '建立失敗'
      },
      failedTitle: '建立失敗（{count}）',
      partialTitle: '商品已建立，但部分步驟失敗（{count}）',
      noResults: '沒有匯入結果',
      confirmImport: '確認匯入',
      progressPreparing: '準備匯入...',
      step: {
        create: '建立商品',
        availability: '設定 Availability',
        price: '設定 Base Price',
        customPrice: '設定自訂價格',
        localization: '建立 Localization'
      },
      toast: {
        validationFail: '驗證失敗',
        importFail: '匯入失敗',
        ipcFail: 'IPC 呼叫失敗: {detail}'
      }
    }
  },

  google: {
    toolbar: {
      sync: '同步商品',
      export: '匯出',
      import: '匯入',
      searchPlaceholder: '搜尋 Product ID / Name...',
      create: '+ 新增商品',
      productCount: '{count} 個商品',
      productCountFiltered: '{filtered} / {total} 個商品'
    },
    batch: {
      selected: '已選 {count} 項',
      clearSelection: '取消選取',
      activate: '批次上架',
      deactivate: '批次下架',
      confirmActivate: '確定要上架選取的 {count} 個商品嗎？',
      confirmDeactivate: '確定要下架選取的 {count} 個商品嗎？',
      processingActivate: '正在批次上架...',
      processingDeactivate: '正在批次下架...',
      activateSuccess: '成功上架 {count} 項',
      deactivateSuccess: '成功下架 {count} 項',
      failedItems: '失敗 {count} 項\n{details}',
      opFailed: '操作失敗'
    },
    filter: {
      all: '全部 {count}'
    },
    status: {
      ACTIVE: '上架中',
      INACTIVE: '已下架',
      INACTIVE_PUBLISHED: '已下架（保留）',
      DRAFT: '草稿',
      NO_PURCHASE_OPTION: '未設定方案'
    },
    statusMixed: '{active}/{total} 上架中',
    empty: {
      noProducts: '尚無商品資料',
      noProductsHint: '請先設定 Google 憑證，然後點擊「同步商品」',
      filteredEmpty: '此狀態下沒有商品'
    },
    progress: {
      connecting: '正在連線...',
      exportPreparing: '準備匯出...'
    },
    toast: {
      syncSuccess: '同步完成，共 {count} 個商品',
      syncFail: '同步失敗',
      exportEmpty: '沒有可匯出的商品，請先同步',
      exportFail: '匯出失敗',
      exportPartial: '已匯出 {exported}/{total}，{failed} 項失敗\n{details}',
      exportSuccess: '匯出完成：{count} 個商品',
      detectSuccess: '已偵測到預設語言：{language}',
      detectFail: '偵測失敗',
      regionFail: '無法取得支援地區',
      // create
      createFillRequired: '請填寫商品 ID 和名稱',
      createIdInvalid: 'Product ID 必須以小寫英數開頭，只能含小寫英數、_、.',
      createNeedLanguage: '請選擇語言',
      createNeedRegion: '請選擇基準國家',
      createNeedCurrency: '找不到該國家的幣別',
      createNeedPrice: '請輸入有效的基準價格',
      createNeedPoId: '請填寫 Purchase Option ID',
      createPoIdInvalid: 'Purchase Option ID 必須以小寫英數開頭，只能含小寫英數和 -',
      createSuccess: '商品已建立（草稿）',
      createSuccessSkipped:
        '商品已建立（草稿）。略過 {count} 個地區：{regions}（可到 Play Console 手動設定）',
      createFail: '建立失敗'
    },
    create: {
      title: '新增 Google 商品',
      productIdHint: '以小寫英數開頭，只能含小寫英數、_、.；建立後無法修改',
      productIdPlaceholder: '例：coins_100',
      languageLabel: '語言',
      languageHint: '按「偵測」會從 Play Console 讀取並設為專案預設；手動選擇則只影響此次建立。',
      languagePlaceholder: '請選擇語言',
      detect: '偵測',
      detecting: '偵測中...',
      nameLabel: '名稱',
      namePlaceholder: '例：100 金幣',
      descriptionLabel: '描述',
      descriptionPlaceholder: '商品描述',
      poSection: '方案設定（建立為草稿狀態，需到 Play Console 再上架）',
      poIdLabel: 'Purchase Option ID',
      poIdHint: '以小寫英數開頭，只能含小寫英數和 -（不可有 _ 或 .）',
      poIdPlaceholder: '例：base',
      purchaseTypeLabel: 'Purchase type',
      rentNotSupported: 'Rent（尚未支援）',
      baseRegionLabel: '基準國家',
      baseRegionLoading: '載入中...',
      baseRegionPlaceholder: '請選擇基準國家',
      basePriceLabel: '基準價格',
      basePricePlaceholder: '例：30',
      autoConvertHint: '其他國家的價格會由 Google 依基準價自動換算。',
      creating: '建立中...'
    },
    detail: {
      tabs: {
        info: 'Info',
        purchaseOptions: 'Purchase Options',
        pricing: 'Pricing',
        listings: 'Listings'
      },
      info: {
        idLockedHint: 'Product ID 建立後無法修改',
        poCount: '共 {count} 個方案',
        listingCount: '共 {count} 個語言'
      },
      purchaseOptions: {
        summary: '共 {count} 個方案',
        empty: '尚無方案',
        addPo: '+ 新增方案',
        regionsCount: '{count} countries / regions',
        backwardsCompatible: 'Backwards compatible',
        setAsPrimary: '設為主方案',
        primaryConfirm:
          '將「{poId}」設為主方案（Backwards compatible）？\n\n設定後，使用舊版 Billing Library（v5 以前）的 client 會看到這個方案的定價。原本的主方案會失去此標記，但其狀態（上架/下架）不變。',
        primaryNonBuy: '只有 BUY 型方案可以設為主方案',
        toggleConfirm: '確定要{label}方案「{poId}」嗎？',
        addDialogTitle: '新增 Purchase Option',
        addPoIdHint: '以小寫英數開頭，只能含小寫英數和 -（不可有 _ 或 .）；建立後無法修改',
        addPoIdPlaceholder: '例如：premium',
        baseRegionLabel: '基準國家',
        baseRegionPlaceholder: '選擇基準國家',
        basePriceLabel: '基準價格',
        addAutoConvertHint:
          '其他國家的價格由 Google 自動換算。新方案建立後為 DRAFT 狀態，需要手動上架。',
        addingButton: '新增中...',
        addButton: '新增',
        toast: {
          poIdRequired: '請輸入 Purchase Option ID',
          poIdInvalid: 'Purchase Option ID 必須以小寫英數開頭，只能含小寫英數和 -',
          poIdExists: '此 Purchase Option ID 已存在',
          regionRequired: '請選擇基準國家',
          currencyMissing: '找不到該國家的幣別',
          priceRequired: '請輸入有效的價格',
          addSuccess: '方案已新增',
          addSuccessSkipped: '方案已新增，略過 {count} 個地區：{regions}',
          addFail: '新增失敗',
          primarySuccess: '「{poId}」已設為主方案',
          primaryFail: '設定失敗',
          toggleSuccess: '方案已{label}',
          toggleFail: '{label}失敗'
        }
      },
      pricing: {
        poLabel: '方案',
        poPlaceholder: '選擇方案',
        regionSearchLabel: '搜尋地區',
        regionSearchPlaceholder: '代碼或名稱',
        noPo: '沒有方案',
        adjustBase: '調整基準定價',
        baseRegionLabel: '基準國家',
        baseRegionPlaceholder: '選擇基準國家',
        priceLabel: '價格',
        applyButton: '套用新價格',
        applyingButton: '套用中...',
        applyHint: '套用後其他國家的價格由 Google 自動換算，將覆蓋目前所有地區的定價。',
        regionColumn: '地區',
        codeColumn: '代碼',
        priceColumn: '價格',
        noRegions: '找不到地區',
        applyConfirm: '確定要用 {region} {currency} {price} 當基準，更新所有地區的價格嗎？',
        toast: {
          regionRequired: '請選擇基準國家',
          currencyMissing: '找不到該國家的幣別',
          priceRequired: '請輸入有效的價格',
          applySuccess: '定價已更新',
          applySuccessSkipped: '定價已更新，略過 {count} 個地區：{regions}',
          applyFail: '更新失敗'
        }
      },
      listings: {
        langCount: '共 {count} 個語言',
        addLang: '+ 新增語言',
        empty: '尚無 listings',
        dialogTitleNew: '新增 Listing',
        dialogTitleEdit: '編輯 Listing',
        langLabel: '語言',
        langPlaceholder: '選擇語言',
        titleLabel: '名稱 (title)',
        descriptionLabel: '描述 (description)',
        deleteConfirm: '確定刪除 {language} 的 listing 嗎？',
        toast: {
          langExists: '此語言已存在',
          listingNotFound: '找不到要更新的 listing',
          minOne: '至少需保留一個 listing',
          updateSuccess: 'Listings 已更新',
          updateFail: '儲存失敗',
          deleteSuccess: '已刪除',
          deleteFail: '刪除失敗',
          fillRequired: {
            language: '請選擇語言',
            title: '請填寫名稱'
          }
        }
      }
    },
    import: {
      header: {
        validating: '驗證檔案中...',
        validationError: '匯入檔案有問題',
        preview: '確認匯入',
        importing: '匯入中',
        done: '匯入結果'
      },
      validating: '讀取並驗證檔案中...',
      issuesIntro: '發現 {issues} 個問題（{products} 筆商品），請修正後重新匯入：',
      productsIntro: '將匯入 {count} 個商品：',
      draftHint: '匯入的商品一律以 DRAFT 狀態建立。請自行在 Detail 頁確認後再手動上架。',
      importingHint: '匯入過程請勿關閉視窗',
      stats: {
        fullSuccess: '完全成功',
        partial: '部分成功',
        failed: '建立失敗'
      },
      failedTitle: '建立失敗（{count}）',
      partialTitle: '商品已建立，但部分步驟失敗（{count}）',
      fullSuccessSkipTitle: '完成匯入但有略過地區',
      googleSkippedRegions: 'Google 略過的地區（{count}）：{regions}',
      skippedRegions: '略過地區（{count}）：{regions}',
      noResults: '沒有匯入結果',
      confirmImport: '確認匯入',
      progressPreparing: '準備匯入...',
      table: {
        nameColumn: 'Name',
        posColumn: 'POs',
        basePriceColumn: '主 PO 基準價',
        basePriceColumnRegion: '主 PO 基準價 ({region})',
        regionsColumn: '地區',
        listingsColumn: '語言'
      },
      step: {
        create: '建立商品'
      },
      toast: {
        validationFail: '驗證失敗',
        importFail: '匯入失敗',
        ipcFail: 'IPC 呼叫失敗: {detail}'
      }
    }
  }
}

export default zhTW
export type I18nMessages = typeof zhTW
