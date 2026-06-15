(() => {
  "use strict";

  const SUMMARY_CLASS = "slb-bet-summary";
  const betsDatabase = new Map();
  let cachedApiHeaders = null;
  let cachedApiBaseUrl = null;
  let autoCollectTriggered = false;

  const TEXT = {
    win: "\u8d0f",
    lose: "\u8f38",
    pending: "\u672a\u6d3e\u5f69",
    voided: "\u9000\u56de",
    unknown: "-",
    bet: "\u6295\u6ce8",
    option: "\u6295\u6ce8\u9078\u9805",
  };

  // 1. Inject Interceptor into Main World
  function injectMainWorldScript() {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("inject.js");
      script.onload = function() {
          this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
  }

  // Inject main world script in all frames
  if (location.href.includes("www-talo-ssb-pr") || location.href.includes("member.sportslottery")) {
      injectMainWorldScript();
  }

  // 2. Listen for the Main World message in the iframe
  window.addEventListener('message', async (e) => {
      if (!e.data) return;

      // When the iframe's Main World catches the API, it tells the iframe's Content Script
      if (e.data.type === 'SLB_API_CAUGHT_MAIN') {
          // If we are INSIDE the iframe, we can fetch natively without CORS!
          if (location.href.includes("www-talo-ssb-pr") && !autoCollectTriggered) {
              autoCollectTriggered = true;
              cachedApiHeaders = e.data.headers;
              cachedApiBaseUrl = e.data.baseUrl;
              
              // Tell parent we started
              if (window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'SLB_FETCH_START' }, '*');
              }
              
              // Fetch the data
              const allBets = await fetchAllDataNatively(cachedApiBaseUrl, cachedApiHeaders, e.data.queryStr);
              
              // Send the massive data block to the parent!
              if (window.parent && window.parent !== window) {
                  window.parent.postMessage({ 
                      type: 'SLB_DATA_FETCHED', 
                      bets: Array.from(allBets.values())
                  }, '*');
              }
          }
      }
      
      // When the iframe receives a manual fetch command from the Parent
      if (e.data.type === 'SLB_FETCH_MANUAL') {
          if (location.href.includes("www-talo-ssb-pr")) {
              if (cachedApiBaseUrl && cachedApiHeaders) {
                  // Fetch the data
                  fetchAllDataNatively(cachedApiBaseUrl, cachedApiHeaders, e.data.queryStr).then(allBets => {
                      if (window.parent && window.parent !== window) {
                          window.parent.postMessage({ 
                              type: 'SLB_DATA_FETCHED', 
                              bets: Array.from(allBets.values())
                          }, '*');
                      }
                  });
              }
          }
      }
      
      // When the Parent Window receives the start signal
      if (e.data.type === 'SLB_FETCH_START') {
          if (!location.href.includes("my-bets")) return;
          showModal();
          updateStatus("正在透過背後通道拉取 30 天內的注單資料...");
      }

      // When the Parent Window receives the fetched data
      if (e.data.type === 'SLB_DATA_FETCHED') {
          if (!location.href.includes("my-bets")) return;
          showModal();
          updateStatus("資料拉取完成！正在渲染報表...");
          if (e.data.error) {
              updateStatus(`<span style="color:red">API 錯誤: ${e.data.error}</span>`);
          } else {
              renderBets(e.data.bets);
          }
      }
  });

  // Safe DOM manipulation wrapper
  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(fn, 1);
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
  }

  // 3. UI and Logic in the Main Frame
  function ensureStyles() {
    if (document.getElementById("slb-modal-styles")) return;
    const style = document.createElement("style");
    style.id = "slb-modal-styles";
    style.textContent = `
      #slb-modal-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.85); z-index: 999999999;
        display: flex; justify-content: center; align-items: center;
        backdrop-filter: blur(5px);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        transition: opacity 0.3s ease;
      }
      #slb-modal-box {
        background: #111827; width: 90vw; max-width: 1400px; height: 90vh;
        border-radius: 16px; display: flex; flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid #374151;
        overflow: hidden; color: #f3f4f6;
        transition: all 0.3s ease;
      }
      .slb-modal-header {
        padding: 20px 24px; border-bottom: 1px solid #374151;
        display: flex; justify-content: space-between; align-items: center;
        background: #1f2937;
      }
      .slb-modal-title { font-size: 20px; font-weight: 700; color: #fff; margin: 0; }
      .slb-modal-subtitle { font-size: 14px; color: #9ca3af; margin-top: 4px; }
      .slb-action-btns {
        display: flex; gap: 16px; align-items: center;
      }
      .slb-btn {
        background: none; border: none; color: #9ca3af; font-size: 24px;
        cursor: pointer; transition: color 0.2s, transform 0.2s; padding: 0 4px;
        line-height: 1; display: flex; align-items: center; justify-content: center;
      }
      .slb-btn:hover { color: #fff; transform: scale(1.1); }
      .slb-modal-content {
        flex: 1; overflow-y: auto; background: #111827;
      }
      .slb-table {
        width: 100%; border-collapse: collapse; text-align: left;
      }
      .slb-table th {
        background: #1f2937; color: #9ca3af; padding: 12px 16px;
        font-weight: 600; font-size: 13px; border-bottom: 1px solid #374151;
        position: sticky; top: 0; z-index: 10;
      }
      .slb-table td {
        padding: 12px 16px; border-bottom: 1px solid #374151;
        font-size: 14px; color: #e5e7eb; vertical-align: middle;
      }
      .slb-row {
        background: #111827; transition: background 0.2s;
      }
      .slb-row:hover {
        background: #1f2937;
      }
      .slb-date { font-size: 13px; color: #9ca3af; white-space: nowrap; }
      .slb-type { font-weight: 600; color: #e5e7eb; white-space: nowrap; }
      .slb-content { 
        max-width: 400px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        color: #60a5fa; cursor: help;
      }
      .slb-amount { font-weight: 700; white-space: nowrap; }
      .slb-amount.win { color: #34d399; }
      
      .slb-badge {
        padding: 4px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600;
        white-space: nowrap; display: inline-block; text-align: center;
      }
      .slb-badge-pending { background: rgba(245, 158, 11, 0.2); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.3); }
      .slb-badge-win { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
      .slb-badge-lose { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
      
      .slb-loading-container {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 100%; width: 100%; color: #60a5fa; grid-column: 1/-1;
      }
      .slb-spinner {
        width: 48px; height: 48px; border: 4px solid rgba(96, 165, 250, 0.2);
        border-top-color: #60a5fa; border-radius: 50%;
        animation: slb-spin 1s linear infinite; margin-bottom: 16px;
      }
      @keyframes slb-spin { to { transform: rotate(360deg); } }

      /* Minimized Floating Button */
      #slb-minimized-btn {
        position: fixed; bottom: 20px; right: 20px; z-index: 999999999;
        background: #111827; border: 1px solid #374151; border-radius: 9999px;
        padding: 12px 24px; color: #fff; font-weight: 600; cursor: pointer;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5);
        display: flex; align-items: center; gap: 8px; transition: transform 0.2s;
      }
      #slb-minimized-btn:hover { transform: scale(1.05); }
      #slb-minimized-btn svg { width: 20px; height: 20px; color: #60a5fa; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function showModal() {
    onReady(() => {
        let overlay = document.getElementById("slb-modal-overlay");
        let miniBtn = document.getElementById("slb-minimized-btn");

        if (!overlay) {
            ensureStyles();
            overlay = document.createElement("div");
            overlay.id = "slb-modal-overlay";
            overlay.innerHTML = `
                <div id="slb-modal-box">
                    <div class="slb-modal-header">
                        <div>
                            <div class="slb-modal-title">自動統計報表</div>
                            <div style="margin-top: 8px; font-size: 14px; color: #d1d5db; display: flex; align-items: center; gap: 8px;">
                                📅 查詢區間：
                                <input type="date" id="slb-date-from" style="background:#374151; color:#fff; border:1px solid #4b5563; border-radius:4px; padding:2px 4px; color-scheme: dark;">
                                <span>~</span>
                                <input type="date" id="slb-date-to" style="background:#374151; color:#fff; border:1px solid #4b5563; border-radius:4px; padding:2px 4px; color-scheme: dark;">
                                <button id="slb-date-search" class="slb-btn" style="background:#2563eb; color:#fff; padding:2px 8px; border-radius:4px;">搜尋</button>
                            </div>
                            <div class="slb-modal-subtitle" id="slb-status-text" style="margin-top: 8px;">正在初始化...</div>
                        </div>
                        <div class="slb-action-btns">
                            <label style="color:#9ca3af; font-size:14px; display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; margin-right:10px;">
                                <input type="checkbox" id="slb-auto-open-cb" style="-webkit-appearance: checkbox !important; appearance: auto !important; display: inline-block !important; opacity: 1 !important; visibility: visible !important; position: static !important; width: 16px !important; height: 16px !important; margin: 0 !important; cursor: pointer !important;"> 預設打開
                            </label>
                            <button class="slb-btn" id="slb-export-btn" title="匯出 CSV" style="font-size:16px; background:#059669; color:#fff; border-radius:6px; padding:4px 12px; font-weight:bold;">匯出 CSV</button>
                            <button class="slb-btn" id="slb-minimize-btn" title="縮小">_</button>
                        </div>
                    </div>
                    <div class="slb-modal-content" id="slb-modal-content">
                        <div class="slb-loading-container">
                            <div class="slb-spinner"></div>
                            <div id="slb-loading-text">正在等待攔截 API...</div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            miniBtn = document.createElement("div");
            miniBtn.id = "slb-minimized-btn";
            miniBtn.innerHTML = `
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                台灣運彩投注報表
            `;
            document.body.appendChild(miniBtn);
            
            const autoOpenCb = document.getElementById("slb-auto-open-cb");
            const autoOpenPref = localStorage.getItem("slb_auto_open");
            const isAutoOpen = autoOpenPref === null ? true : autoOpenPref === "true";
            autoOpenCb.checked = isAutoOpen;
            
            autoOpenCb.addEventListener("change", (e) => {
                localStorage.setItem("slb_auto_open", e.target.checked ? "true" : "false");
            });
            
            // 根據設定決定預設狀態
            if (isAutoOpen) {
                overlay.style.display = "flex";
                miniBtn.style.display = "none";
            } else {
                overlay.style.display = "none";
                miniBtn.style.display = "flex";
            }

            document.getElementById("slb-minimize-btn").addEventListener("click", () => {
                overlay.style.display = "none";
                miniBtn.style.display = "flex";
            });

            document.getElementById("slb-export-btn").addEventListener("click", exportCSV);

            miniBtn.addEventListener("click", () => {
                miniBtn.style.display = "none";
                overlay.style.display = "flex";
            });
            
            // Init date inputs
            const fromEl = document.getElementById("slb-date-from");
            const toEl = document.getElementById("slb-date-to");
            if (fromEl && toEl) {
                const today = new Date();
                const past30 = new Date(); past30.setDate(today.getDate() - 30);
                const formatD = d => d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
                fromEl.value = formatD(past30);
                toEl.value = formatD(today);
            }

            document.getElementById("slb-date-search").addEventListener("click", () => {
                const fv = document.getElementById("slb-date-from").value;
                const tv = document.getElementById("slb-date-to").value;
                if (!fv || !tv) return;
                
                const newQs = `from=${fv}T00:00:00.000&to=${tv}T23:59:59.999`;
                
                const statusEl = document.getElementById("slb-status-text");
                if(statusEl) statusEl.innerHTML = "正在拉取指定區間...";
                
                const contentEl = document.getElementById("slb-modal-content");
                if (contentEl) {
                    contentEl.innerHTML = `
                        <div class="slb-loading-container">
                            <div class="slb-spinner"></div>
                            <div id="slb-loading-text">資料載入中...</div>
                        </div>
                    `;
                }

                // Send message to IFRAME to fetch
                const frames = document.getElementsByTagName('iframe');
                for (let i = 0; i < frames.length; i++) {
                    frames[i].contentWindow.postMessage({
                        type: 'SLB_FETCH_MANUAL',
                        queryStr: newQs
                    }, '*');
                }
            });
        } else {
            overlay.style.display = "flex";
        }
    });
  }

  function updateStatus(text) {
      const el = document.getElementById("slb-status-text");
      const lel = document.getElementById("slb-loading-text");
      if (el) el.innerHTML = text;
      if (lel) lel.innerHTML = text;
  }

  function exportCSV() {
      if (!window.currentSLBBets || window.currentSLBBets.length === 0) {
          alert("目前沒有資料可匯出！");
          return;
      }
      
      let csvContent = "\uFEFF"; // BOM for UTF-8 Excel compatibility
      csvContent += "下注時間,玩法,投注內容,投注額,預計/實際派彩,狀態\n";
      
      window.currentSLBBets.forEach(b => {
          let createdDate = b.createdDate || "Invalid Date";
          if (createdDate !== "Invalid Date") {
              const d = new Date(createdDate.replace(' ', 'T'));
              if (!isNaN(d.getTime())) {
                  createdDate = d.toLocaleString('zh-TW', {
                      year: 'numeric', month: '2-digit', day: '2-digit', 
                      hour: '2-digit', minute: '2-digit'
                  });
              }
          }
          
          let legTexts = b.legs ? b.legs.map(leg => `[${leg.eventName}] ${leg.marketName} - ${leg.selectionName}`) : [];
          let contentText = legTexts.join(" | ");
          contentText = '"' + contentText.replace(/"/g, '""') + '"'; // Escape quotes for CSV
          
          let stateText = b.betState;
          let displayReturn = b.totalReturn || 0;
          if (["Settled", "CashedOut", "Closed", "Won", "Lost"].includes(b.betState)) {
               stateText = displayReturn > 0 ? "贏" : "輸";
          } else if (b.betState === "Void" || b.betState === "Cancelled") {
               stateText = "退回";
          } else {
               stateText = "未派彩";
          }
          
          csvContent += `${createdDate},${b.betTypeName || "單場"},${contentText},${b.totalStake},${displayReturn},${stateText}\n`;
      });
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `運彩投注報表_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  }

  function renderBets(betsArray) {
      const container = document.getElementById("slb-modal-content");
      if (!container) return;

      window.slbSortCol = window.slbSortCol || 'date';
      if (window.slbSortDesc === undefined) window.slbSortDesc = true;

      const sortedBets = [...betsArray].sort((a, b) => {
          let valA, valB;
          if (window.slbSortCol === 'date') {
              valA = new Date((a.createdDate || "").replace(' ', 'T')).getTime() || 0;
              valB = new Date((b.createdDate || "").replace(' ', 'T')).getTime() || 0;
          } else if (window.slbSortCol === 'type') {
              valA = a.betTypeName || "單場";
              valB = b.betTypeName || "單場";
          } else if (window.slbSortCol === 'stake') {
              valA = a.totalStake || 0;
              valB = b.totalStake || 0;
          } else if (window.slbSortCol === 'return') {
              valA = a.totalReturn || 0;
              valB = b.totalReturn || 0;
          } else if (window.slbSortCol === 'state') {
              valA = a.betState || "";
              valB = b.betState || "";
          }

          if (valA < valB) return window.slbSortDesc ? 1 : -1;
          if (valA > valB) return window.slbSortDesc ? -1 : 1;
          return 0;
      });

      if (sortedBets.length === 0) {
          container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #9ca3af;">沒有找到任何注單記錄。</div>`;
          return;
      }
      
      window.currentSLBBets = sortedBets;
      window.originalSLBBets = betsArray;

      function getSortIcon(col) {
          if (window.slbSortCol !== col) return '<span style="color:#6b7280; font-size:12px; margin-left:4px;">↕</span>';
          return window.slbSortDesc ? '<span style="color:#34d399; font-size:12px; margin-left:4px;">↓</span>' : '<span style="color:#34d399; font-size:12px; margin-left:4px;">↑</span>';
      }

      let totalBet = 0;
      let settledBet = 0;
      let settledReturn = 0;
      let lostStake = 0;
      let winProfit = 0;
      let pendingStake = 0;

      let tableHtml = `
          <table class="slb-table">
              <thead>
                  <tr>
                      <th data-sort="date" style="cursor:pointer; user-select:none;" title="點擊排序">下注時間 ${getSortIcon('date')}</th>
                      <th data-sort="type" style="cursor:pointer; user-select:none;" title="點擊排序">玩法 ${getSortIcon('type')}</th>
                      <th>投注內容</th>
                      <th data-sort="stake" style="cursor:pointer; user-select:none;" title="點擊排序">投注額 ${getSortIcon('stake')}</th>
                      <th data-sort="return" style="cursor:pointer; user-select:none;" title="點擊排序">預計/實際派彩 ${getSortIcon('return')}</th>
                      <th data-sort="state" style="cursor:pointer; user-select:none;" title="點擊排序">狀態 ${getSortIcon('state')}</th>
                  </tr>
              </thead>
              <tbody>
      `;

      sortedBets.forEach(b => {
          totalBet += (b.totalStake || 0);
          
          let badgeClass = "slb-badge-pending";
          let badgeText = TEXT.pending;
          let isWin = false;
          
          let displayReturn = b.totalReturn || 0;

          if (["Settled", "CashedOut", "Closed", "Won", "Lost"].includes(b.betState)) {
              settledBet += (b.totalStake || 0);
              settledReturn += displayReturn;
              if (displayReturn > 0) {
                  badgeClass = "slb-badge-win";
                  badgeText = TEXT.win;
                  isWin = true;
                  winProfit += (displayReturn - (b.totalStake || 0));
              } else {
                  badgeClass = "slb-badge-lose";
                  badgeText = TEXT.lose;
                  lostStake += (b.totalStake || 0);
              }
          } else if (b.betState === "Void" || b.betState === "Cancelled") {
              badgeClass = "slb-badge-pending";
              badgeText = TEXT.voided;
              // Void bets are settled but usually return stake. We count them in settled
              settledBet += (b.totalStake || 0);
              settledReturn += displayReturn;
          } else {
              pendingStake += (b.totalStake || 0);
          }

          let createdDate = b.createdDate || "Invalid Date";
          if (createdDate !== "Invalid Date") {
              const d = new Date(createdDate.replace(' ', 'T'));
              if (!isNaN(d.getTime())) {
                  createdDate = d.toLocaleString('zh-TW', {
                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                  });
              }
          }

          const escapeHTML = (str) => {
              return String(str).replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;")
                                .replace(/"/g, "&quot;")
                                .replace(/'/g, "&#039;");
          };

          let contentText = "";
          let fullContentText = "";
          if (b.legs && b.legs.length > 0) {
              const htmlLegTexts = b.legs.map(leg => {
                  const ev = escapeHTML(leg.eventName || '未知');
                  const mk = escapeHTML(leg.marketName || '');
                  const sel = escapeHTML(leg.selectionName || '');
                  return `[${ev}] ${mk} - <b>${sel}</b>`;
              });
              const plainLegTexts = b.legs.map(leg => {
                  const ev = escapeHTML(leg.eventName || '未知');
                  const mk = escapeHTML(leg.marketName || '');
                  const sel = escapeHTML(leg.selectionName || '');
                  return `[${ev}] ${mk} - ${sel}`;
              });
              contentText = htmlLegTexts.join(" <span style='color:#6b7280'>|</span> ");
              fullContentText = plainLegTexts.join("\n");
          } else {
              contentText = "無法讀取詳細資訊";
              fullContentText = "無法讀取詳細資訊";
          }

          tableHtml += `
              <tr class="slb-row">
                  <td class="slb-date">${createdDate}</td>
                  <td class="slb-type">${escapeHTML(b.betTypeName || "單場")}</td>
                  <td class="slb-content" title="${fullContentText}">${contentText}</td>
                  <td class="slb-amount">NT$ ${b.totalStake}</td>
                  <td class="slb-amount ${isWin ? 'win' : ''}">NT$ ${displayReturn}</td>
                  <td><span class="slb-badge ${badgeClass}">${badgeText}</span></td>
              </tr>
          `;
      });
      
      tableHtml += `</tbody></table>`;
      container.innerHTML = tableHtml;

      const summaryEl = document.getElementById("slb-status-text");
      if (summaryEl) {
          const pl = settledReturn - settledBet;
          summaryEl.innerHTML = `
            <div style="margin-bottom:6px;">
                <span style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:4px; margin-right:8px;">
                    💰 <b>本金去向</b>：總投入 <b>NT$ ${totalBet}</b> = 未派彩 <span style="color:#fcd34d">NT$ ${pendingStake}</span> + 已結算本金 <b>NT$ ${settledBet}</b>
                </span>
            </div>
            <div>
                <span style="background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:4px;">
                    🏆 <b>結算戰績</b>：總派彩 <span style="color:#34d399">NT$ ${settledReturn}</span> - 已結算本金 <b>NT$ ${settledBet}</b> = 淨損益 <b style="color:${pl >= 0 ? '#34d399' : '#f87171'}">NT$ ${pl}</b>
                </span>
            </div>
          `;
      }
      
      container.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', () => {
              const col = th.getAttribute('data-sort');
              if (window.slbSortCol === col) {
                  window.slbSortDesc = !window.slbSortDesc;
              } else {
                  window.slbSortCol = col;
                  window.slbSortDesc = true;
              }
              renderBets(window.originalSLBBets);
          });
      });
  }

  // NATIVE FETCH INSIDE IFRAME (Same-Origin, NO CORS ERRORS!)
  async function fetchAllDataNatively(baseUrl, headers, queryStr) {
      let finalBaseUrl = baseUrl;
      if (!finalBaseUrl.startsWith("http")) {
           finalBaseUrl = "https://www-talo-ssb-pr.sportslottery.com.tw" + (finalBaseUrl.startsWith('/') ? '' : '/') + finalBaseUrl;
      }
      
      const localDatabase = new Map();

      let fromStr, toStr;
      if (queryStr) {
          try {
              const params = new URLSearchParams(queryStr);
              if (params.get("from")) fromStr = params.get("from");
              if (params.get("to")) toStr = params.get("to");
          } catch(e) {}
      }

      if (!fromStr || !toStr) {
          const today = new Date();
          const past30 = new Date();
          past30.setDate(today.getDate() - 30);
          
          function formatLocal(d) {
              const pad = n => n.toString().padStart(2, '0');
              return d.getFullYear() + '-' +
                     pad(d.getMonth() + 1) + '-' +
                     pad(d.getDate()) + 'T' +
                     pad(d.getHours()) + ':' +
                     pad(d.getMinutes()) + ':' +
                     pad(d.getSeconds()) + '.' +
                     d.getMilliseconds().toString().padStart(3, '0');
          }
          fromStr = formatLocal(past30);
          toStr = formatLocal(today);
      }
      


      async function fetchState(betState) {
          let pageNum = 0;
          let hasMore = true;

          while (hasMore && pageNum < 10) {
              const params = new URLSearchParams({
                  from: fromStr,
                  to: toStr,
                  orderBy: 0,
                  pageNumber: pageNum,
                  pageSize: 50,
                  orderDesc: true
              });
              
              if (betState === "Opened") {
                  params.append("betStateTypes", "Opened");
                  params.append("betOutcomes", "NotSpecified");
              } else if (betState === "Settled") {
                  params.append("betStateTypes", "Closed,Settled,Cancelled");
                  params.append("betOutcomes", "NotSpecified");
              }

              // ensure + is not encoded or whatever, just standard URLSearchParams is fine.
              const targetUrl = finalBaseUrl + "?" + params.toString();

              try {
                  const resp = await window.fetch(targetUrl, {
                      method: "GET",
                      headers: headers
                  });

                  if (!resp.ok) {
                      if (window.parent) window.parent.postMessage({ type: 'SLB_DATA_FETCHED', error: `HTTP ${resp.status} - ${await resp.text()}` }, '*');
                      break;
                  }

                  const text = await resp.text();
                  if (!text || text.trim() === "") {
                      hasMore = false;
                      break;
                  }

                  const data = JSON.parse(text);
                  if (data && data.length > 0) {
                      data.forEach(item => {
                          if (item.fullExternalReference) {
                              const betId = item.fullExternalReference;
                              if (!localDatabase.has(betId)) {
                                  localDatabase.set(betId, {
                                      id: betId,
                                      createdDate: item.tsAttempted,
                                      betTypeName: item.betTypeName,
                                      betState: item.betState,
                                      totalStake: item.totalStake || item.wunitStake || 0,
                                      totalReturn: item.betState === 'Open' ? item.potentialReturn : (item.totalReturn || item.discountedTotalReturn || 0),
                                      legs: []
                                  });
                              }
                              localDatabase.get(betId).legs.push({
                                  eventName: item.eventName,
                                  marketName: item.marketName,
                                  selectionName: item.selectionName
                              });
                          }
                      });
                      if (data.length < 50) hasMore = false;
                      else pageNum++;
                  } else {
                      hasMore = false;
                  }
              } catch (e) {
                  if (window.parent) window.parent.postMessage({ type: 'SLB_DATA_FETCHED', error: `Fetch failed: ${e.message}` }, '*');
                  break;
              }
          }
      }

      await fetchState("Opened");
      await fetchState("Settled");
      
      return localDatabase;
  }
})();
