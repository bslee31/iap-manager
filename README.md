[English](./README.en.md) | **繁體中文**

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
  - 匯入並行 3，單商品失敗不中斷其他商品；完成後顯示完全成功 / 部分成功 / 建立失敗分組結果

### Google One-time Products

- 同步商品列表（含 Purchase Option 彙總狀態與主 PO 在 Base Region 的價格）
- 列表欄位：Product ID / Product name / Price / Status，佈局對齊 Apple
  - Price 取「主 PO」（`buyOption.legacyCompatible=true`，Play Console 的 Backwards compatible）在 Base Region 的價格
  - Status 採優先順序聚合（ACTIVE > INACTIVE > DRAFT > NO_PURCHASE_OPTION）；多 PO 混合狀態會顯示 `N/M 上架中`
- 批次上架 / 下架（作用於主 PO / Backwards compatible，對齊列表 Price 欄的語意；alternate PO 不受影響，如需個別操作請進 Detail）
- 依狀態篩選（上架中、已下架、草稿、未設定方案等）
- 新增商品
  - 指定 Purchase Option ID、Base Region 與 Base Price，後端以 `convertRegionPrices` 套用到所有支援地區並以 DRAFT 狀態建立
  - Base Region 價格強制使用使用者輸入值（不讓 Google 市場最佳化將 TWD 200 調整為 210 之類），其他地區仍使用 Google 建議換算
  - `regionsVersion 2022/02` 拒絕的地區（例如歐元過渡期的 BG、已不可計費地區）會從錯誤回應解析出來並重試，不讓少數失效地區擋住整筆建立；略過的地區會在成功提示中列出
  - Listing 語言下拉選單以專案預設值為基準，亦提供「從 Play Console 偵測」按鈕（透過 Edits API 取得預設語言）並同步更新專案設定
- 商品詳情 Modal（點擊商品列開啟，佈局對齊 Apple）：
  - **Info** — 顯示 Product ID / Status 與 Purchase Options、Listings 的數量摘要
  - **Purchase Options** — 列出所有方案並可逐一啟用 / 停用；每行顯示方案類型、Base Region 的基準價（便於跨方案比對）、`N countries / regions` 計數，主 PO 加註 `Backwards compatible` 標籤；非主 PO 的 BUY 方案可一鍵「設為主方案」切換 `buyOption.legacyCompatible`（Google 規定每個商品至多一個，切換時會自動清除其他 PO 的旗標）；支援新增方案（指定 POid + Base Region + Base Price，以 DRAFT 狀態追加，沿用 `convertRegionPrices` + drop-and-retry 邏輯）
  - **Pricing** — 檢視 / 修改主 PO（或選定 PO）各地區價格；「套用新價格」表單指定 Base Region 與價格後，以 `convertRegionPrices` 重算並 PATCH 商品，沿用建立流程的 drop-and-retry 邏輯避開失效地區（Base Region 同樣強制採用輸入值）
  - **Listings** — 新增 / 編輯 / 刪除多語言標題與描述
- **匯出 / 匯入（批次建立商品）**
  - JSON 格式（`formatVersion: 1`），以 Product ID 排序；每個商品包含完整 listings 與 purchaseOptions（含每個 PO 的 `state` / `type` / `legacyCompatible` 以及所有地區的 `availability` + `currencyCode` + `units` / `nanos`，完整保留，匯入能直接套回）
  - 匯出：預設匯出全部商品，有勾選時只匯出勾選項目；並行 5 個商品、進度顯示，單商品失敗不中斷其他商品
  - 匯入：兩階段流程 — 先驗證（formatVersion、productId 唯一性與格式、listing 欄位長度、PO 狀態 / 型別 / `legacyCompatible` 限制、地區代碼）並顯示預覽，確認後才批次建立
  - 匯入並行 3，商品以單次 PATCH（`listings,purchaseOptions` + `allowMissing=true`）建立，沿用 create 的 drop-and-retry 邏輯略過 Google 拒絕的地區；所有 PO 一律以 DRAFT 建立，原始 state 不會套用，請至 Detail 頁確認後再手動上架
  - 單商品失敗不中斷其他商品；完成後顯示完全成功 / 部分成功 / 建立失敗分組結果，也會列出匯入時被 Google 略過的地區
  - 目前只支援匯入 BUY 型 PO（RENT 尚未實作）

### Google 專案設定

- **Default Language** — 新增商品 / Listings 的預設語言，可從 Play Console 自動偵測或手動選擇
- **Base Region** — 每專案持久化的基準地區（migration 009），首次建立商品時自動填入，可於專案設定頁手動覆寫；商品詳情的 Pricing 會將此地區置頂

### 多專案管理

- 每個專案獨立的 Apple / Google 憑證
- 專案列表和側欄支援拖曳排序
- 切換專案時保留分頁狀態

## Tech Stack

- Electron + electron-vite
- Vue 3 + TypeScript + Vue Router + Pinia
- Tailwind CSS
- better-sqlite3（本地資料庫）
- Electron safeStorage（憑證加密，使用 OS Keychain）

## 安裝

```bash
npm install
```

## 開發

```bash
npm run dev          # 啟動 dev server（electron-vite watch mode）
npm run test         # 跑測試（vitest watch mode）
```

## CI

每個 push / PR 在 GitHub Actions 跑 5 關品管：

```bash
npm run lint         # ESLint
npm run format:check # Prettier
npm run typecheck    # vue-tsc
npm run test:run     # vitest
npm run build        # electron-vite（main / preload / renderer）
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
3. 在 Google Play Console > **Users and permissions** 邀請該 Service Account
4. 依 App 狀態授予對應權限：
   - App status = **Draft**：授予 **Draft apps** 下的 **Edit and delete draft apps**
   - App status = **Production**：授予 **Store presence** 下的 **Manage store presence**
5. 在工具的「憑證設定」分頁匯入 JSON 檔案並輸入 **Package Name**

## 資料儲存

| 項目                     | 位置                                          |
| ------------------------ | --------------------------------------------- |
| 資料庫（專案、商品快取） | `~/.iap-manager/data.db`                      |
| 加密憑證                 | `~/.iap-manager/credentials/<project-id>.enc` |

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
- 建立 / 更新：`PATCH /applications/{pkg}/onetimeproducts/{id}` (`updateMask` + `allowMissing=true` + `regionsVersion=2022/02`)
- 價格換算：`POST /applications/{pkg}/pricing:convertRegionPrices`
- 上下架：`POST /applications/{pkg}/oneTimeProducts/{id}/purchaseOptions:batchUpdateStates`
- Edits API（取得 Play Console 預設語言）：`POST /applications/{pkg}/edits` → `GET /edits/{editId}/listings`
- 注意：URL 大小寫不一致（LIST 用 `oneTimeProducts`，PATCH 用 `onetimeproducts`）
