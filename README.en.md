**English** | [繁體中文](./README.md)

# IAP Manager

Batch management tool for Apple & Google in-app purchases.

Avoids repetitive operations in the consoles (e.g. deactivating products one by one), with multi-project support.

## Features

### Apple In-App Purchases

- Sync product list
- Batch activate / deactivate
- Batch refresh of Price / Availability
- Filter by status (Approved, Removed, Missing Metadata, etc.)
- Create products (consumable / non-consumable)
- Product detail modal (opens on row click):
  - **Info** — shows Product ID / Type / State (read-only); edit Reference Name (auto-disabled in review states)
  - **Availability** — toggle availability per region, grouped to match the App Store Connect layout
  - **Price Schedule** — set base price, view equivalent prices in every territory, edit individual territory prices
  - **Localization** — add / edit / delete multi-locale names and descriptions
- **Export / Import (batch create products)**
  - JSON format (`formatVersion: 1`), includes Product ID / Reference Name / Type / Availability / Price Schedule / Localization
  - Export: defaults to all products; exports only the selection when checkboxes are used
  - Import: two-stage workflow — validate first (format, field length, uniqueness, territory codes) and show a preview, then batch create only after confirmation
  - Import concurrency 3, per-product failures don't abort the rest; results are grouped into full success / partial / failed after completion

### Google One-time Products

- Sync product list (with aggregated Purchase Option status and the primary PO's Base-Region price)
- List columns: Product ID / Product name / Price / Status, laid out to match Apple
  - Price uses the "primary PO" (`buyOption.legacyCompatible=true`, the Play Console "Backwards compatible" one) at the Base Region
  - Status uses priority-based aggregation (ACTIVE > INACTIVE > DRAFT > NO_PURCHASE_OPTION); mixed-state across multiple POs shows `N/M ACTIVE`
- Batch activate / deactivate (acts on the primary PO / Backwards compatible, matching the list Price column's semantics; alternate POs are unaffected — use the Detail page for individual ops)
- Filter by status (Active, Inactive, Draft, No purchase option, etc.)
- Create products
  - Specify Purchase Option ID, Base Region and Base Price; the backend applies `convertRegionPrices` to every supported region and creates the product in DRAFT state
  - The Base Region price is forced to the user-supplied value (preventing Google's market optimization from rounding TWD 200 to 210, etc.); other regions still use Google's converted prices
  - Regions rejected by `regionsVersion 2022/02` (e.g. BG during the Eurozone transition, or regions no longer billable) are parsed out of the error response and retried, so a few invalid regions don't block the whole create; skipped regions are listed in the success message
  - The Listing language dropdown defaults to the project setting; a "Detect from Play Console" button is also available (uses the Edits API to fetch the default language) and syncs the result back to the project setting
- Product detail modal (opens on row click, layout matches Apple):
  - **Info** — shows Product ID / Status plus Purchase Option and Listing counts
  - **Purchase Options** — lists every option with individual activate / deactivate; each row shows option type, the Base Region's base price (for cross-option comparison), the `N countries / regions` count, and tags the primary PO with `Backwards compatible`; non-primary BUY options have a one-click "Set as primary" toggle for `buyOption.legacyCompatible` (Google allows at most one per product, so toggling auto-clears the flag on every other PO); supports adding new options (specify POid + Base Region + Base Price, appended as DRAFT, reusing the `convertRegionPrices` + drop-and-retry logic)
  - **Pricing** — view / edit per-region pricing of the primary PO (or a selected PO); the "Apply new pricing" form takes a Base Region and price, recomputes via `convertRegionPrices` and PATCHes the product, reusing the create flow's drop-and-retry to skip invalid regions (the Base Region price is also forced to the user input)
  - **Listings** — add / edit / delete multi-locale titles and descriptions
- **Export / Import (batch create products)**
  - JSON format (`formatVersion: 1`), sorted by Product ID; each product includes complete listings and purchaseOptions (each PO's `state` / `type` / `legacyCompatible` plus every region's `availability` + `currencyCode` + `units` / `nanos`, lossless — can be reapplied verbatim)
  - Export: defaults to all products; exports only the selection when checkboxes are used; 5 concurrent products with progress shown; per-product failures don't abort the rest
  - Import: two-stage workflow — validate first (formatVersion, productId uniqueness and format, listing field lengths, PO state / type / `legacyCompatible` constraints, region codes) and show a preview, then batch create only after confirmation
  - Import concurrency 3, products are created with a single PATCH (`listings,purchaseOptions` + `allowMissing=true`), reusing the create flow's drop-and-retry to skip Google-rejected regions; all POs are created as DRAFT — the original state is not applied, please review in the Detail page before activating manually
  - Per-product failures don't abort the rest; results are grouped into full success / partial / failed after completion, and regions Google skipped during import are listed
  - Currently only BUY POs are supported for import (RENT not yet implemented)

### Google project settings

- **Default Language** — default language used by new products / Listings; can be auto-detected from Play Console or set manually
- **Base Region** — per-project persistent base region (migration 009), auto-filled on first product creation, can be manually overridden in the project settings page; the Detail page's Pricing tab puts this region first

### Multi-project management

- Independent Apple / Google credentials per project
- Project list and sidebar support drag-and-drop reordering
- Tab state preserved when switching projects

## Tech stack

- Electron + electron-vite
- Vue 3 + TypeScript
- Tailwind CSS
- better-sqlite3 (local database)
- Electron safeStorage (credential encryption, backed by the OS Keychain)

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

## Packaging

```bash
npm run dist          # macOS
npm run dist:win      # Windows
npm run dist:linux    # Linux
```

## Credential setup

### Apple App Store Connect

1. Go to [App Store Connect > Users and Access > Integrations > Team Keys](https://appstoreconnect.apple.com/access/integrations/api)
2. Create an API Key and download the `.p8` file
3. Note the **Key ID** and **Issuer ID**
4. Find your **App ID** (numeric) in App Store Connect
5. In the tool's Credential settings tab, fill in the values above and import the `.p8` file

### Google Play Console

1. In [Google Cloud Console](https://console.cloud.google.com/), create a Service Account
2. Download the Service Account's JSON key file
3. In Google Play Console > **Users and permissions**, invite the Service Account
4. Grant permissions per app status:
   - App status = **Draft**: grant **Edit and delete draft apps** under **Draft apps**
   - App status = **Production**: grant **Manage store presence** under **Store presence**
5. In the tool's Credential settings tab, import the JSON file and fill in the **Package Name**

## Data storage

| Item                               | Location                                      |
| ---------------------------------- | --------------------------------------------- |
| Database (projects, product cache) | `~/.iap-manager/data.db`                      |
| Encrypted credentials              | `~/.iap-manager/credentials/<project-id>.enc` |

Credentials are encrypted with Electron safeStorage, which is backed by macOS Keychain / Windows DPAPI under the hood.

## API references

### Apple

- [App Store Connect API v1/v2](https://developer.apple.com/documentation/appstoreconnectapi)
- List: `GET /v1/apps/{appId}/inAppPurchasesV2`
- Create: `POST /v2/inAppPurchases`
- Update (Reference Name, etc.): `PATCH /v2/inAppPurchases/{id}`
- Availability: `GET /v2/inAppPurchases/{id}/inAppPurchaseAvailability`
- Activate / deactivate: `POST /v1/inAppPurchaseAvailabilities`
- Price Schedule: `GET /v2/inAppPurchases/{id}/iapPriceSchedule`
- Price Points: `GET /v2/inAppPurchases/{id}/pricePoints`
- Set price: `POST /v1/inAppPurchasePriceSchedules`
- Localization: `GET /v2/inAppPurchases/{id}/inAppPurchaseLocalizations`
- Create Localization: `POST /v1/inAppPurchaseLocalizations`
- Territories: `GET /v1/territories`

### Google

- [Google Play Developer API v3 - Monetization](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts)
- List: `GET /applications/{pkg}/oneTimeProducts`
- Create / update: `PATCH /applications/{pkg}/onetimeproducts/{id}` (`updateMask` + `allowMissing=true` + `regionsVersion=2022/02`)
- Price conversion: `POST /applications/{pkg}/pricing:convertRegionPrices`
- Activate / deactivate: `POST /applications/{pkg}/oneTimeProducts/{id}/purchaseOptions:batchUpdateStates`
- Edits API (fetch Play Console default language): `POST /applications/{pkg}/edits` → `GET /edits/{editId}/listings`
- Note: URL casing is inconsistent (LIST uses `oneTimeProducts`, PATCH uses `onetimeproducts`)
