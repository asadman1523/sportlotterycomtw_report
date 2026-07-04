# AGENTS.md - sportslottery_bet_free

這個資料夾是公開版 Chrome Extension。它和 `../sportlotterycomtw_report_pro` 是分開的 repo/專案，但互補：本專案負責使用者端報表與 Pro 驗證；Pro 專案負責私鑰備份與啟動序號產生。

## 專案角色

- 產品名稱：運彩視覺化UI。
- 平台：Chrome Manifest V3 extension。
- 目標頁面：台灣運彩「我的投注」相關頁面。
- 核心用途：在使用者瀏覽器本機攔截已載入的投注 API，彙整注單、篩選、排序、顯示損益，並匯出 CSV。
- 隱私邊界：投注資料只在使用者瀏覽器處理，不送到開發者伺服器。
- Pro 關係：本專案只驗證 `SLB2` 啟動序號並解鎖 UI/查詢限制；不要在這裡放私鑰或產生授權碼。

## 與 Pro 專案的分工

- 本專案擁有：`manifest.json`、content script、page-world interceptor、UI、public key、README/PRIVACY、測試。
- Pro 專案擁有：private JWK、加密備份、`SLB2` 簽章碼產生工具、本機 Pro tools UI。
- 兩邊共享的授權協定常數必須一致：
  - `LICENSE_CODE_PREFIX = "SLB2"`
  - `LICENSE_AUTH_REQUEST_PREFIX = "SLBAUTH2"`
  - `LICENSE_AUTH_APP = "sportslottery_bet"`
  - `LICENSE_AUTH_VERSION = 2`
  - 簽章：ECDSA P-256 + SHA-256，簽章輸入是 `SLB2.<payloadPart>`。
- 若變更授權 payload、簽章格式、public key 或版本，必須同步修改 Pro 專案與本專案測試。

## 重要檔案

- `manifest.json`：MV3 設定。content script 跑在 `https://member.sportslottery.com.tw/*` 與 `https://www-talo-ssb-pr.sportslottery.com.tw/*`，並暴露 `inject.js` 與 LINE 圖示資源。
- `sportslottery-my-bets.user.js`：主要 content script，負責注入、跨 frame 訊息、免責聲明、Pro 驗證、資料補抓、UI、篩選、排序、CSV。
- `inject.js`：注入到 page main world，包裝 `window.fetch` 與 `XMLHttpRequest`，偵測 `betting/fo/bets` API，透過 `window.postMessage` 回傳 base URL、query string 與 request headers。
- `background.js`：唯一 background bridge。只處理 `SLB_GET_PROFILE_USER_INFO`，透過 `chrome.identity.getProfileUserInfo({ accountStatus: "ANY" })` 取得 Chrome account id/email。
- `tests/sportslottery-my-bets.test.js`：Node test，主要用靜態斷言保護 UI 文字、授權流程、日期限制、過關篩選、分段抓取與注單顯示邏輯。
- `tests/fixtures/parlay-filter-sample.json`：過關篩選測試資料。
- `scripts/backfill_release_notes.py`：用 git tags/commits 回填 GitHub release notes。
- `PRIVACY.md`：Chrome Web Store 相關隱私說明。改動資料處理或權限時要同步更新。

## Runtime 資料流

1. content script 在支援網域注入 `inject.js`。
2. `inject.js` 在 page main world 偵測 `betting/fo/bets` 的 fetch/XHR，送出 `SLB_API_CAUGHT_MAIN`。
3. iframe 裡的 content script 快取 API base URL、headers、query string。
4. 使用者接受免責聲明後，iframe 以同源身分補抓資料，避免 parent frame CORS 問題。
5. 長日期範圍會切成最多 30 天一段，分別抓 `Opened` 與 `Settled/Closed/Cancelled`，每頁 50 筆、最多 50 頁。
6. 抓取中會送 `SLB_FETCH_PROGRESS` 與 partial `SLB_DATA_FETCHED`，parent frame 先渲染已載入資料。
7. 新搜尋會 abort 目前抓取，並用 `fetchRunId` 避免舊結果覆蓋新結果。
8. parent frame 在 my-bets 頁面顯示 overlay/report panel，提供日期快捷、球類篩選、派彩狀態、過關數篩選、排序、複製整行與 CSV 匯出。

## 授權與 Pro 行為

- 免費版限制：最近 365 天內查詢；24 小時、7 天、30 天快捷可用。
- Pro 解鎖：最近 730 天內查詢；1/3/6/12 小時快捷與特定過關數篩選。
- Pro prompt 產生 `SLBAUTH2.<base64url(payload)>`，payload 包含 Chrome `accountId`、email、app、licenseVersion。
- 使用者把 `SLBAUTH2` 裝置/授權資料交給 Pro 工具後，會收到 `SLB2.<payload>.<signature>`。
- 本專案用內建 public JWK 驗證 `SLB2` 簽章，並確認 payload `version`、`plan: "pro"`、`accountId`。
- 啟動序號與驗證 payload 存在 `chrome.storage.local` 與 `chrome.storage.sync`。sync 失敗要顯示警示，但 local 仍可運作。

## 注單與 UI 邏輯注意事項

- 未派彩注單不能把 `potentialReturn` 當作實際派彩；淨損益只對已結算注單計算。
- 一關、多關、全部過關的判斷以 `betTypeName` 為主，不要用 `legs.length` 推論過關數。
- `accumulator` / `全部過關` 是獨立類型，不應混入數字過關篩選。
- 多腿注單要保留每腿狀態欄位：`betLegStatus`、`winWLDOutcome`、`eventResult`、`outcome` 等。
- 單腿注單若沒有總賠率，要能 fallback 顯示 leg odds。
- UI 文字目前以繁體中文為主；release notes 可用繁中 / English 雙語。
- 本專案只做歷史注單視覺化；不要加入帳密同步、OTP、自動送出投注或任何開發者端收集投注資料的功能。

## 開發規則

- 維持原生 JavaScript/IIFE 架構；目前沒有 bundler 或前端框架。
- content script 受頁面 CSS 影響，新增控制項時要用 `slb-` prefix 並注意樣式隔離。
- 同源補抓必須在 `www-talo-ssb-pr` iframe 內做；parent frame 不應直接 fetch 投注 API。
- 修改 `chrome` 權限、host matches、identity 行為或資料儲存時，同步更新 `README.md`、`PRIVACY.md` 與測試。
- 版本發布時同步更新 `manifest.json` 與 `package.json` 的 version。
- 不要把 Pro private key、加密密碼、使用者授權資料或真實注單 CSV commit 進來。

## 驗證

主要命令：

```powershell
npm test
```

這會執行：

- `node --check sportslottery-my-bets.user.js`
- `node --check background.js`
- `node --test tests/*.test.js`

需要手動驗證 UI 時：

1. Chrome 開啟 `chrome://extensions/`。
2. 啟用 Developer mode。
3. Load unpacked 選這個資料夾。
4. 登入台灣運彩，進入「我的投注」。
5. 檢查免責聲明、日期搜尋、分段載入進度、篩選、排序、CSV、Pro prompt。

## AI agent 任務路由

- 如果任務是 extension 功能、UI、測試、版本、README、PRIVACY，留在本專案處理。
- 如果任務是產生啟動序號、私鑰備份、Pro tools UI，改到 `../sportlotterycomtw_report_pro`。
