const zhTW = {
  app: {
    title: 'IAP 管理工具'
  },
  sidebar: {
    projects: '專案列表',
    newProject: '新增專案',
    settings: '設定'
  },
  project: {
    name: '專案名稱',
    description: '專案描述',
    create: '新增專案',
    edit: '編輯專案',
    delete: '刪除專案',
    deleteConfirm: '確定要刪除此專案嗎？此操作無法復原。',
    noProjects: '尚未建立任何專案',
    save: '儲存',
    cancel: '取消'
  },
  tabs: {
    apple: 'Apple IAP',
    google: 'Google 商品',
    credentials: '憑證設定'
  },
  credentials: {
    apple: {
      title: 'Apple App Store Connect',
      keyId: 'Key ID',
      issuerId: 'Issuer ID',
      p8File: '私鑰檔案 (.p8)',
      importP8: '匯入 .p8 檔案',
      appId: 'App ID'
    },
    google: {
      title: 'Google Play Console',
      jsonFile: '服務帳戶金鑰 (JSON)',
      importJson: '匯入 JSON 檔案',
      packageName: 'Package Name'
    },
    testConnection: '測試連線',
    save: '儲存憑證',
    configured: '已設定',
    notConfigured: '未設定'
  },
  products: {
    sync: '同步商品',
    importCsv: '從 CSV 匯入',
    create: '新增商品',
    edit: '編輯',
    productId: '商品 ID',
    name: '名稱',
    status: '狀態',
    price: '價格',
    lastSync: '上次同步',
    noProducts: '尚無商品資料，請先同步或新增商品',
    syncing: '同步中...'
  },
  batch: {
    selected: '已選 {count} 項',
    activate: '批次上架',
    deactivate: '批次下架',
    updatePrice: '批次調價',
    confirmActivate: '確定要上架選取的 {count} 個商品嗎？',
    confirmDeactivate: '確定要下架選取的 {count} 個商品嗎？',
    processing: '處理中...',
    resultSuccess: '成功 {success} 項',
    resultFail: '失敗 {fail} 項'
  },
  common: {
    confirm: '確認',
    cancel: '取消',
    save: '儲存',
    delete: '刪除',
    loading: '載入中...',
    error: '發生錯誤',
    success: '操作成功'
  }
}

export default zhTW
export type I18nMessages = typeof zhTW
