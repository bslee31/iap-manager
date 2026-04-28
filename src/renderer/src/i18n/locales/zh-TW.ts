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
  }
}

export default zhTW
export type I18nMessages = typeof zhTW
