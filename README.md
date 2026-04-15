# IAP Manager

Apple & Google 應用程式內購商品批次管理工具。

避免在後台重複操作（例如逐一下架商品），支援多專案管理。

## 功能

### Apple In-App Purchases
- 同步商品列表（含 Availability 地區數量）
- 批次上架 / 下架
- 依狀態篩選（已核准、已下架、缺少資料等）
- 單一商品 Availability 重新同步
- 新增商品

### Google One-time Products
- 同步商品列表（含 Purchase Option 狀態）
- 批次上架 / 下架（透過 Purchase Options 狀態管理）
- 依狀態篩選（上架中、已下架、草稿、未設定方案等）
- 新增商品

### 多專案管理
- 每個專案獨立的 Apple / Google 憑證
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
- Availability：`GET /v2/inAppPurchases/{id}/inAppPurchaseAvailability`
- 上下架：`POST /v1/inAppPurchaseAvailabilities`

### Google
- [Google Play Developer API v3 - Monetization](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts)
- 列表：`GET /applications/{pkg}/oneTimeProducts`
- 上下架：`POST /applications/{pkg}/oneTimeProducts/{id}/purchaseOptions:batchUpdateStates`
- 注意：URL 大小寫不一致（LIST 用 `oneTimeProducts`，PATCH 用 `onetimeproducts`）
