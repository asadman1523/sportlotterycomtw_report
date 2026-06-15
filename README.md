# sportslottery_bet

Chrome / Edge extension for Taiwan Sports Lottery my-bets.

## 功能

- 不讀 API，不處理登入 session。
- 不顯示右側彈窗或提示框。
- 在官方「我的投注」清單裡，每張單子的最上方加入一行摘要：

```text
輸/贏 日期 - 玩法 -> 投注選項
```

- 預設只顯示摘要；點摘要可展開/收合原本完整資訊。

## 安裝

1. 開啟 `chrome://extensions/` 或 `edge://extensions/`。
2. 開啟「開發人員模式」。
3. 選「載入未封裝項目」。
4. 選這個資料夾：`C:\Users\Jack\Documents\sportslottery_bet`。
5. 回到 `https://member.sportslottery.com.tw/account/my-bets` 重新整理頁面。

## 檔案

- `manifest.json`: extension 設定。
- `sportslottery-my-bets.user.js`: 插入投注摘要與展開/收合邏輯。
