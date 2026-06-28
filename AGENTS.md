# Codex 專案入口

## 專案目的

這是台灣運彩「我的投注」頁面的 Chrome extension，用來彙整注單、顯示投注額、賠率、派彩、淨損益與下注狀態。

## 工作分流

- `sportslottery_bet-app-*`: 功能開發、UI 調整、測試、版本、commit、push。
- `sportslottery-analysis-*`: 比賽分析、下注判斷、盤口快照、FotMob/運彩資料，只讀或輸出快照。
- 如果任務同時包含產品功能和下注分析，先拆成兩段，不要在同一輪混改程式與投注結論。

## 常用命令

- 測試: `npm test`
- 主要程式: `sportslottery-my-bets.user.js`
- 注入入口: `inject.js`
- Extension manifest: `manifest.json`
- 測試檔: `tests/sportslottery-my-bets.test.js`

## Skill 路由

- FotMob 單場資料包: 使用 `fotmob-match-extractor`。
- 台灣運彩盤口快照: 使用 `taiwan-sportslottery-markets`。
- 下注、場中、串關、正確比分分析: 使用 `lottery-sport-bet`。
- 盤口可用性只代表可執行價格，不可當作預測證據。

## Subagent 授權

- 賽前足球下注分析時，使用者明確授權並要求 Codex 使用 subagent 做一次決策覆核。

## 文件與資料規則

- 工作流模板放在 `docs/codex_workflows.md`。
- 使用者可交付文件才放 `outputs`；中間資料放 `work` 或任務指定位置。
- 不修改全域 Codex 設定，不移動既有 Codex 日期線程資料。
- 不刪 cache、不跑 `git clean`，除非使用者明確要求。

## 驗證要求

- 程式碼或 UI 變更後跑 `npm test`。
- 投注卡片相關改動要檢查: 投注項、賠率、預計派彩、實際派彩、淨損益、狀態、一關 xN/串關呈現。
- 回覆與 commit message 優先使用繁體中文；release 相關 commit 可用「繁中 / English」雙語格式。
