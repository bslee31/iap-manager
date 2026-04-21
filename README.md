# IAP Manager

Apple & Google 應用程式內購商品批次管理工具。

避免在後台重複操作（例如逐一下架商品），支援多專案管理。

## 功能

### Apple In-App Purchases
- 同步商品列表
- 批次上架 / 下架
- 批次重整 Price / Availability
- 依狀態篩選（已核准、已下架、缺少資料等）
- 新增商品（消耗型 / 非消耗型）
- 商品詳情 Modal（點擊商品列開啟）：
  - **Info** — 顯示 Product ID / Type / State（唯讀），修改 Reference Name（審核中狀態自動 disable）
  - **Availability** — 依區域分組勾選上架地區（匹配 App Store Connect 佈局）
  - **Price Schedule** — 設定基準價格、查看所有地區等價、修改個別地區價格
  - **Localization** — 新增/編輯/刪除多語言名稱與描述
- **匯出 / 匯入（批次建立商品）**
  - JSON 格式（`formatVersion: 1`），包含 Product ID / Reference Name / Type / Availability / Price Schedule / Localization
  - 匯出：預設匯出全部商品，有勾選時只匯出勾選項目
  - 匯入：兩階段流程 — 先驗證（格式、欄位長度、唯一性、地區代碼）並顯示預覽，確認後才批次建立
  - 匯入併發 3，單商品失敗不中斷其他商品；完成後顯示完全成功 / 部分成功 / 建立失敗分組結果

### Google One-time Products
- 同步商品列表（含 Purchase Option 狀態）
- 批次上架 / 下架（透過 Purchase Options 狀態管理）
- 依狀態篩選（上架中、已下架、草稿、未設定方案等）
- 新增商品

### 多專案管理
- 每個專案獨立的 Apple / Google 憑證
- 專案列表和側欄支援拖曳排序
- 切換專案時保留分頁狀態

## 技術棧

- Electron + electron-vite
- Vue 3 + TypeScript
- Tailwind CSS
- better-sqlite3（本地資料庫）
- Electron safeStorage（憑證加密，使用 OS Keychain）

## 安裝

```bash
npm install
```

## 開發

```bash
npm run dev
```

## 打包

```bash
npm run dist          # macOS
npm run dist:win      # Windows
npm run dist:linux    # Linux
```

## 憑證設定

### Apple App Store Connect

1. 前往 [App Store Connect > Users and Access > Integrations > Team Keys](https://appstoreconnect.apple.com/access/integrations/api)
2. 建立 API Key，下載 `.p8` 檔案
3. 記下 **Key ID** 和 **Issuer ID**
4. 在 App Store Connect 找到你的 **App ID**（數字）
5. 在工具的「憑證設定」分頁輸入以上資訊並匯入 `.p8` 檔案

### Google Play Console

1. 前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 Service Account
2. 下載 Service Account 的 JSON 金鑰檔案
3. 在 [Google Play Console > Settings > API access](https://play.google.com/console/developers/api-access) 連結該 Service Account
4. 授予 **Manage store presence** 權限
5. 在工具的「憑證設定」分頁匯入 JSON 檔案並輸入 **Package Name**

## 資料儲存

| 項目 | 位置 |
|------|------|
| 資料庫（專案、商品快取） | `~/.iap-manager/data.db` |
| 加密憑證 | `~/.iap-manager/credentials/<project-id>.enc` |

憑證使用 Electron safeStorage 加密，底層透過 macOS Keychain / Windows DPAPI 保護。

## API 參考

### Apple
- [App Store Connect API v1/v2](https://developer.apple.com/documentation/appstoreconnectapi)
- 列表：`GET /v1/apps/{appId}/inAppPurchasesV2`
- 建立：`POST /v2/inAppPurchases`
- 更新（Reference Name 等）：`PATCH /v2/inAppPurchases/{id}`
- Availability：`GET /v2/inAppPurchases/{id}/inAppPurchaseAvailability`
- 上下架：`POST /v1/inAppPurchaseAvailabilities`
- Price Schedule：`GET /v2/inAppPurchases/{id}/iapPriceSchedule`
- Price Points：`GET /v2/inAppPurchases/{id}/pricePoints`
- 設定價格：`POST /v1/inAppPurchasePriceSchedules`
- Localization：`GET /v2/inAppPurchases/{id}/inAppPurchaseLocalizations`
- 建立 Localization：`POST /v1/inAppPurchaseLocalizations`
- 地區列表：`GET /v1/territories`

### Google
- [Google Play Developer API v3 - Monetization](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts)
- 列表：`GET /applications/{pkg}/oneTimeProducts`
- 上下架：`POST /applications/{pkg}/oneTimeProducts/{id}/purchaseOptions:batchUpdateStates`
- 注意：URL 大小寫不一致（LIST 用 `oneTimeProducts`，PATCH 用 `onetimeproducts`）
