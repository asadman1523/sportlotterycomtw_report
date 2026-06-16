(() => {
  "use strict";

  const SUMMARY_CLASS = "slb-bet-summary";
  const betsDatabase = new Map();
  const DISCLAIMER_ACCEPTED_KEY = "slb_disclaimer_accepted_v1";
  const THEME_STORAGE_KEY = "slb_theme";
  const DISCLAIMER_TEXT = "免責聲明：本工具僅供個人記帳與參考，統計結果不代表官方帳務；所有投注紀錄、派彩與結算資訊皆以台灣運彩官方系統為準。本工具與台灣運彩官方無關。";
  const SPORT_LABELS = {
      FBL: "足球",
      BKB: "籃球",
      BSB: "棒球",
      TNS: "網球",
      OTHER: "其他",
  };
  const SPORT_FILTER_ORDER = ["FBL", "BKB", "BSB", "TNS", "OTHER"];
  let cachedApiHeaders = null;
  let cachedApiBaseUrl = null;
  let cachedApiQueryStr = null;
  let autoCollectTriggered = false;
  let disclaimerAcceptedInThisPage = false;
  let disclaimerStorageLoaded = false;
  const disclaimerStorageReady = loadDisclaimerAccepted();

  const TEXT = {
    win: "\u8d0f",
    lose: "\u8f38",
    pending: "\u672a\u6d3e\u5f69",
    voided: "\u9000\u56de",
    unknown: "-",
    bet: "\u6295\u6ce8",
    option: "\u6295\u6ce8\u9078\u9805",
  };

  window.slbSelectedSportTypes = window.slbSelectedSportTypes || [];

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
          if (location.href.includes("www-talo-ssb-pr")) {
              cachedApiHeaders = e.data.headers;
              cachedApiBaseUrl = e.data.baseUrl;
              cachedApiQueryStr = e.data.queryStr;
              const acceptedDisclaimer = await ensureDisclaimerStateLoaded();
              if (!autoCollectTriggered && acceptedDisclaimer) {
                  autoCollectTriggered = true;
                  await fetchAndPostData(cachedApiQueryStr);
              } else if (!acceptedDisclaimer && window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'SLB_DISCLAIMER_REQUIRED' }, '*');
              }
          }
      }

      if (e.data.type === 'SLB_DISCLAIMER_REQUIRED') {
          if (!location.href.includes("my-bets")) return;
          showModal();
          if (await ensureDisclaimerStateLoaded()) {
              broadcastDisclaimerAccepted();
          } else {
              showDisclaimerNotice();
          }
      }

      if (e.data.type === 'SLB_DISCLAIMER_ACCEPTED') {
          disclaimerAcceptedInThisPage = true;
          if (location.href.includes("www-talo-ssb-pr") && cachedApiBaseUrl && cachedApiHeaders && !autoCollectTriggered) {
              autoCollectTriggered = true;
              await fetchAndPostData(cachedApiQueryStr);
          }
      }
      
      // When the iframe receives a manual fetch command from the Parent
      if (e.data.type === 'SLB_FETCH_MANUAL') {
          if (location.href.includes("www-talo-ssb-pr") && await ensureDisclaimerStateLoaded()) {
              if (cachedApiBaseUrl && cachedApiHeaders) {
                  // Fetch the data
                  fetchAndPostData(e.data.queryStr);
              }
          }
      }
      
      // When the Parent Window receives the start signal
      if (e.data.type === 'SLB_FETCH_START') {
          if (!location.href.includes("my-bets")) return;
          showModal();
          if (!await ensureDisclaimerStateLoaded()) {
              showDisclaimerNotice();
              return;
          }
          updateStatus("正在載入資料...");
      }

      // When the Parent Window receives the fetched data
      if (e.data.type === 'SLB_DATA_FETCHED') {
          if (!location.href.includes("my-bets")) return;
          showModal();
          if (!await ensureDisclaimerStateLoaded()) {
              showDisclaimerNotice();
              return;
          }
          
          if (e.data.fromStr) {
              const fromEl = document.getElementById("slb-date-from");
              if (fromEl) fromEl.value = e.data.fromStr.split('T')[0];
          }
          if (e.data.toStr) {
              const toEl = document.getElementById("slb-date-to");
              if (toEl) toEl.value = e.data.toStr.split('T')[0];
          }

          updateStatus("資料拉取完成！正在渲染報表...");
          if (e.data.error) {
              updateStatus(`<span class="slb-error-text">API 錯誤: ${e.data.error}</span>`);
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

  function hasAcceptedDisclaimer() {
    return disclaimerAcceptedInThisPage;
  }

  function getExtensionStorage() {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return null;
      return chrome.storage.local;
  }

  function loadDisclaimerAccepted() {
      return new Promise((resolve) => {
          const storage = getExtensionStorage();
          if (!storage) {
              disclaimerStorageLoaded = true;
              resolve(false);
              return;
          }
          storage.get([DISCLAIMER_ACCEPTED_KEY], (result) => {
              disclaimerAcceptedInThisPage = result && result[DISCLAIMER_ACCEPTED_KEY] === true;
              disclaimerStorageLoaded = true;
              resolve(disclaimerAcceptedInThisPage);
          });
      });
  }

  async function ensureDisclaimerStateLoaded() {
      if (!disclaimerStorageLoaded) await disclaimerStorageReady;
      return hasAcceptedDisclaimer();
  }

  function saveDisclaimerAccepted() {
      disclaimerAcceptedInThisPage = true;
      disclaimerStorageLoaded = true;
      const storage = getExtensionStorage();
      if (!storage) return Promise.resolve();
      return new Promise((resolve) => {
          storage.set({ [DISCLAIMER_ACCEPTED_KEY]: true }, () => resolve());
      });
  }

  function showDisclaimerNoticeIfNeeded() {
      ensureDisclaimerStateLoaded().then((accepted) => {
          if (!accepted) showDisclaimerNotice();
      });
  }

  async function fetchAndPostData(queryStr) {
      if (!cachedApiBaseUrl || !cachedApiHeaders) return;
      if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'SLB_FETCH_START' }, '*');
      }
      const fetchResult = await fetchAllDataNatively(cachedApiBaseUrl, cachedApiHeaders, queryStr);
      if (window.parent && window.parent !== window) {
          window.parent.postMessage({
              type: 'SLB_DATA_FETCHED',
              bets: Array.from(fetchResult.bets.values()),
              fromStr: fetchResult.fromStr,
              toStr: fetchResult.toStr
          }, '*');
      }
  }

  function broadcastDisclaimerAccepted() {
      const frames = document.getElementsByTagName('iframe');
      for (let i = 0; i < frames.length; i++) {
          frames[i].contentWindow.postMessage({ type: 'SLB_DISCLAIMER_ACCEPTED' }, '*');
      }
  }

  function normalizeSportType(sportType) {
      return SPORT_LABELS[sportType] ? sportType : "OTHER";
  }

  function getSportLabel(sportType) {
      return SPORT_LABELS[normalizeSportType(sportType)];
  }

  function getBetSportTypes(bet) {
      const types = new Set();
      (bet.legs || []).forEach((leg) => {
          types.add(normalizeSportType(leg.idFOSportType));
      });
      if (types.size === 0) types.add("OTHER");
      return types;
  }

  function betMatchesSportFilter(bet) {
      const selected = window.slbSelectedSportTypes || [];
      if (selected.length === 0) return true;
      const sportTypes = getBetSportTypes(bet);
      return selected.some((sportType) => sportTypes.has(sportType));
  }

  function updateSportFilterControls() {
      const optionsEl = document.getElementById("slb-sport-filter-options");
      if (!optionsEl) return;

      const activeSelected = new Set(window.slbSelectedSportTypes || []);
      const allActive = activeSelected.size === 0;
      const buttonsHtml = [
          `<button type="button" class="slb-sport-filter-btn ${allActive ? "active" : ""}" data-sport="ALL">全部</button>`,
          ...SPORT_FILTER_ORDER.map((sportType) =>
              `<button type="button" class="slb-sport-filter-btn ${activeSelected.has(sportType) ? "active" : ""}" data-sport="${sportType}">${getSportLabel(sportType)}</button>`
          ),
      ].join("");

      optionsEl.innerHTML = buttonsHtml;
      optionsEl.querySelectorAll(".slb-sport-filter-btn").forEach((button) => {
          button.addEventListener("click", () => {
              const sportType = button.getAttribute("data-sport");
              if (sportType === "ALL") {
                  window.slbSelectedSportTypes = [];
              } else {
                  const nextSelected = new Set(window.slbSelectedSportTypes || []);
                  if (nextSelected.has(sportType)) nextSelected.delete(sportType);
                  else nextSelected.add(sportType);
                  window.slbSelectedSportTypes = [...nextSelected];
              }
              if (window.originalSLBBets) renderBets(window.originalSLBBets);
          });
      });
  }

  async function updateGitHubStars() {
      const starsEl = document.getElementById("slb-github-stars");
      if (!starsEl) return;

      try {
          const response = await fetch("https://api.github.com/repos/asadman1523/sportlotterycomtw_report");
          if (!response.ok) throw new Error(`GitHub API ${response.status}`);
          const repo = await response.json();
          const stars = Number(repo.stargazers_count || 0);
          starsEl.textContent = stars.toLocaleString("en-US");
      } catch (e) {
          starsEl.textContent = "";
      }
  }

  function updateResultCount(count) {
      const countEl = document.getElementById("slb-result-count");
      if (countEl) countEl.textContent = `共 ${count} 筆資料`;
  }

  function getPreferredTheme() {
      try {
          return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
      } catch (e) {
          return "dark";
      }
  }

  function applyTheme(theme) {
      const nextTheme = theme === "light" ? "light" : "dark";
      const overlay = document.getElementById("slb-modal-overlay");
      const miniBtn = document.getElementById("slb-minimized-btn");
      const themeSwitch = document.getElementById("slb-theme-switch");

      if (overlay) overlay.dataset.theme = nextTheme;
      if (miniBtn) miniBtn.dataset.theme = nextTheme;
      if (themeSwitch) {
          const isLight = nextTheme === "light";
          themeSwitch.classList.toggle("light", isLight);
          themeSwitch.setAttribute("aria-checked", isLight ? "true" : "false");
          themeSwitch.title = isLight ? "切換深色模式" : "切換淺色模式";
      }

      try {
          localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch (e) {}
  }

  // 3. UI and Logic in the Main Frame
  function ensureStyles() {
    if (document.getElementById("slb-modal-styles")) return;
    const style = document.createElement("style");
    style.id = "slb-modal-styles";
    style.textContent = `
      #slb-modal-overlay,
      #slb-minimized-btn {
        --slb-overlay: rgba(8,20,40,0.86);
        --slb-bg: #0f172a;
        --slb-surface: #172033;
        --slb-surface-alt: #1e2a44;
        --slb-hover: #263857;
        --slb-border: #334155;
        --slb-border-strong: #475569;
        --slb-text: #f4f7fa;
        --slb-text-secondary: #d6e1ee;
        --slb-text-muted: #aebbd0;
        --slb-separator: #71809a;
        --slb-primary: #2f80ed;
        --slb-primary-hover: #1c64d1;
        --slb-primary-soft: rgba(47, 128, 237, 0.18);
        --slb-success: #21c07a;
        --slb-success-hover: #179862;
        --slb-success-soft: rgba(33, 192, 122, 0.18);
        --slb-warning: #f4b740;
        --slb-warning-soft: rgba(244, 183, 64, 0.18);
        --slb-danger: #f05252;
        --slb-danger-soft: rgba(240, 82, 82, 0.18);
        --slb-chip-bg: rgba(96, 165, 250, 0.1);
        --slb-shadow: 0 25px 50px -12px rgba(8,20,40,0.58);
        --slb-card-shadow: 0 12px 24px rgba(8,20,40,0.34);
        color-scheme: dark;
      }
      #slb-modal-overlay[data-theme="light"],
      #slb-minimized-btn[data-theme="light"] {
        --slb-overlay: rgba(24,32,42,0.38);
        --slb-bg: #f7f8fa;
        --slb-surface: #ffffff;
        --slb-surface-alt: #eef1f4;
        --slb-hover: #e4e9ee;
        --slb-border: #d7dde3;
        --slb-border-strong: #bdc7d1;
        --slb-text: #18202a;
        --slb-text-secondary: #344251;
        --slb-text-muted: #64717f;
        --slb-separator: #9aa6b2;
        --slb-primary: #2563eb;
        --slb-primary-hover: #1d4ed8;
        --slb-primary-soft: rgba(37, 99, 235, 0.12);
        --slb-success: #07875a;
        --slb-success-hover: #066b49;
        --slb-success-soft: rgba(7, 135, 90, 0.12);
        --slb-warning: #b7791f;
        --slb-warning-soft: rgba(183, 121, 31, 0.14);
        --slb-danger: #dc2626;
        --slb-danger-soft: rgba(220, 38, 38, 0.12);
        --slb-chip-bg: rgba(24,32,42,0.06);
        --slb-shadow: 0 25px 50px -12px rgba(24,32,42,0.28);
        --slb-card-shadow: 0 12px 24px rgba(24,32,42,0.12);
        color-scheme: light;
      }
      #slb-modal-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: var(--slb-overlay); z-index: 999999999;
        display: flex; justify-content: center; align-items: center;
        backdrop-filter: blur(5px);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        transition: opacity 0.3s ease;
      }
      #slb-modal-box {
        background: var(--slb-bg); width: 90vw; max-width: 1400px; height: 90vh;
        border-radius: 16px; display: flex; flex-direction: column;
        box-shadow: var(--slb-shadow); border: 1px solid var(--slb-border);
        overflow: hidden; color: var(--slb-text);
        transition: all 0.3s ease;
        position: relative;
      }
      .slb-modal-header {
        padding: 20px 250px 20px 24px; border-bottom: 1px solid var(--slb-border);
        display: block;
        background: var(--slb-surface);
        position: relative;
      }
      .slb-modal-title { font-size: 20px; font-weight: 700; color: var(--slb-text); margin: 0; }
      .slb-title-row {
        display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
      }
      .slb-modal-subtitle { font-size: 14px; color: var(--slb-text-muted); margin-top: 4px; }
      .slb-filter-row {
        margin-top: 8px; font-size: 14px; color: var(--slb-text-secondary);
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      }
      .slb-sport-filter-options {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      }
      .slb-sport-filter-btn {
        background: var(--slb-surface-alt); color: var(--slb-text-secondary); border: 1px solid var(--slb-border-strong);
        padding: 3px 8px; border-radius: 4px; font-size: 13px; cursor: pointer;
      }
      .slb-sport-filter-btn:hover {
        background: var(--slb-hover); color: var(--slb-text);
      }
      .slb-sport-filter-btn.active {
        background: var(--slb-primary); border-color: var(--slb-primary); color: #fff;
      }
      .slb-disclaimer-line {
        margin-top: 8px; color: var(--slb-warning); font-size: 13px; line-height: 1.5;
      }
      .slb-disclaimer-panel {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        min-height: 100%; padding: 32px 24px; color: var(--slb-text); text-align: center;
      }
      .slb-disclaimer-card {
        width: min(680px, 100%); background: var(--slb-surface); border: 1px solid var(--slb-border-strong);
        border-radius: 8px; padding: 24px; box-shadow: var(--slb-card-shadow);
      }
      .slb-disclaimer-card h3 {
        margin: 0 0 12px; color: var(--slb-text); font-size: 18px;
      }
      .slb-disclaimer-card p {
        margin: 0 0 18px; color: var(--slb-text-secondary); line-height: 1.7; font-size: 15px;
      }
      #slb-accept-disclaimer-btn {
        background: var(--slb-primary); color: #fff; border: 0; border-radius: 6px;
        padding: 10px 16px; font-size: 15px; font-weight: 700; cursor: pointer;
      }
      #slb-accept-disclaimer-btn:hover { background: var(--slb-primary-hover); }
      .slb-auto-open-label {
        color: var(--slb-text-muted); font-size: 14px; display: flex; align-items: center;
        gap: 6px; cursor: pointer; user-select: none;
        white-space: nowrap;
      }
      .slb-header-github {
        position: absolute; top: 20px; right: 66px; z-index: 19;
      }
      .slb-header-export {
        position: absolute; right: 24px; bottom: 20px; z-index: 19;
        display: flex; align-items: center; gap: 10px;
      }
      .slb-result-count {
        color: var(--slb-text-muted); font-size: 13px; white-space: nowrap;
      }
      .slb-sort-icon-muted { color: var(--slb-separator); font-size: 12px; margin-left: 4px; }
      .slb-sort-icon-active { color: var(--slb-success); font-size: 12px; margin-left: 4px; }
      .slb-meta-label { color: var(--slb-text-secondary); }
      .slb-summary-chip {
        display: inline-block; background: var(--slb-chip-bg);
        padding: 4px 8px; border-radius: 4px;
      }
      .slb-summary-warning { color: var(--slb-warning); }
      .slb-summary-success { color: var(--slb-success); }
      .slb-summary-danger { color: var(--slb-danger); }
      .slb-error-text { color: var(--slb-danger); }
      .slb-empty-state {
        grid-column: 1/-1; text-align: center; padding: 40px; color: var(--slb-text-muted);
      }
      .slb-date-shortcut {
        background: var(--slb-surface-alt); color: var(--slb-text-secondary);
        border: 1px solid var(--slb-border-strong); border-radius: 6px;
        height: 28px; padding: 0 9px; font-size: 13px; line-height: 26px;
        font-weight: 600; cursor: pointer;
      }
      .slb-date-shortcut:hover {
        background: var(--slb-hover); color: var(--slb-text);
      }
      .slb-theme-control {
        display: inline-flex; align-items: center; gap: 8px;
        color: var(--slb-text-muted); font-size: 14px; white-space: nowrap;
      }
      .slb-theme-label { color: var(--slb-text-muted); font-size: 14px; }
      .slb-theme-switch {
        position: relative; width: 108px; height: 30px; padding: 0 4px;
        display: grid; grid-template-columns: 1fr 1fr; align-items: center;
        border: 1px solid var(--slb-border-strong); border-radius: 9999px;
        background: var(--slb-surface-alt); color: var(--slb-text-muted);
        font-size: 14px; font-weight: 600; line-height: 1; cursor: pointer;
        overflow: hidden; transition: background 0.2s ease, border-color 0.2s ease;
      }
      .slb-theme-switch::before {
        content: ""; position: absolute; top: 3px; left: 3px;
        width: 50px; height: 22px; border-radius: 9999px;
        background: var(--slb-primary); box-shadow: 0 2px 8px rgba(0,0,0,0.22);
        transition: transform 0.24s ease;
      }
      .slb-theme-switch.light::before { transform: translateX(52px); }
      .slb-theme-switch:hover { border-color: var(--slb-primary); }
      .slb-theme-switch span {
        position: relative; z-index: 1; text-align: center; transition: color 0.2s ease;
      }
      .slb-theme-switch:not(.light) .slb-theme-dark-label,
      .slb-theme-switch.light .slb-theme-light-label {
        color: #fff;
      }
      .slb-date-input {
        background: var(--slb-surface-alt); color: var(--slb-text);
        border: 1px solid var(--slb-border-strong); border-radius: 6px;
        height: 28px; padding: 0 8px; font-size: 13px;
      }
      .slb-date-search-btn {
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--slb-primary); color: #fff; border: 1px solid var(--slb-primary);
        border-radius: 6px; height: 28px; padding: 0 12px;
        font-size: 13px; line-height: 26px; font-weight: 700; cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease;
      }
      .slb-date-search-btn:hover {
        background: var(--slb-primary-hover); border-color: var(--slb-primary-hover); color: #fff;
      }
      .slb-github-button {
        display: inline-flex; align-items: stretch; height: 26px;
        color: var(--slb-text); text-decoration: none; font-size: 12px; font-weight: 700;
        white-space: nowrap;
        line-height: 1;
      }
      .slb-github-button-main,
      .slb-github-button-count {
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--slb-surface-alt); border: 1px solid var(--slb-border-strong);
      }
      .slb-github-button-main {
        gap: 4px; padding: 0 8px; border-radius: 3px 0 0 3px;
      }
      .slb-github-button-count {
        min-width: 26px; padding: 0 7px; border-left: 0;
        border-radius: 0 3px 3px 0;
      }
      .slb-github-button:hover .slb-github-button-main,
      .slb-github-button:hover .slb-github-button-count {
        background: var(--slb-hover);
      }
      .slb-github-icon {
        width: 14px; height: 14px; fill: currentColor;
      }
      #slb-minimize-btn {
        position: absolute; top: 18px; right: 18px; z-index: 20;
        width: 36px; height: 36px; border-radius: 8px;
        background: transparent; border: 1px solid transparent; color: var(--slb-text-muted);
        font-size: 22px; font-weight: 500; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      #slb-minimize-btn:hover {
        color: var(--slb-text); background: var(--slb-chip-bg); border-color: var(--slb-border-strong);
      }
      .slb-btn {
        background: none; border: none; color: var(--slb-text-muted); font-size: 24px;
        cursor: pointer; transition: color 0.2s, transform 0.2s; padding: 0 4px;
        line-height: 1; display: flex; align-items: center; justify-content: center;
      }
      .slb-btn:hover { color: var(--slb-text); transform: scale(1.1); }
      .slb-modal-content {
        flex: 1; overflow-y: auto; background: var(--slb-bg);
      }
      .slb-export-btn {
        background: var(--slb-success); color: #fff; border: 0; border-radius: 6px;
        padding: 4px 10px; font-size: 13px; line-height: 20px; font-weight: 700; cursor: pointer;
      }
      .slb-export-btn:hover { background: var(--slb-success-hover); }
      .slb-table {
        width: 100%; border-collapse: collapse; text-align: left;
      }
      .slb-table th {
        background: var(--slb-surface); color: var(--slb-text-muted); padding: 12px 16px;
        font-weight: 600; font-size: 13px; border-bottom: 1px solid var(--slb-border);
        position: sticky; top: 0; z-index: 10;
      }
      .slb-table td {
        padding: 12px 16px; border-bottom: 1px solid var(--slb-border);
        font-size: 14px; color: var(--slb-text); vertical-align: middle;
      }
      .slb-row {
        background: var(--slb-bg); transition: background 0.2s;
      }
      .slb-row:hover {
        background: var(--slb-hover);
      }
      .slb-date { font-size: 13px; color: var(--slb-text-muted); white-space: nowrap; }
      .slb-table th, .slb-table td {
        padding: 12px; text-align: center; border-bottom: 1px solid var(--slb-border);
      }
      .slb-content {
        max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        color: var(--slb-text-secondary); cursor: pointer; transition: all 0.2s;
      }
      .slb-content:hover {
        color: var(--slb-text);
      }
      .slb-content.expanded {
        white-space: normal;
        max-width: 400px;
        text-align: left;
      }
      .slb-content:not(.expanded) div {
        display: inline;
      }
      .slb-content:not(.expanded) div:not(:last-child)::after {
        content: " | ";
        color: var(--slb-separator);
        margin: 0 4px;
      }
      .slb-content.expanded div.slb-content-leg {
        display: block;
        margin-bottom: 6px;
        padding-bottom: 6px;
        border-bottom: 1px dashed var(--slb-border-strong);
      }
      .slb-content.expanded div.slb-content-leg:last-child {
        border-bottom: none;
        margin-bottom: 0;
        padding-bottom: 0;
      }
      .slb-content:not(.expanded) .slb-content-meta {
        display: none !important;
      }
      .slb-content.expanded .slb-content-meta {
        display: block;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--slb-border-strong);
        font-size: 13px;
        color: var(--slb-text-muted);
      }
      .slb-amount { font-weight: 700; white-space: nowrap; }
      .slb-amount.win { color: var(--slb-success); }
      
      .slb-badge {
        padding: 4px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600;
        white-space: nowrap; display: inline-block; text-align: center;
      }
      .slb-badge-pending { background: var(--slb-warning-soft); color: var(--slb-warning); border: 1px solid var(--slb-warning); }
      .slb-badge-win { background: var(--slb-success-soft); color: var(--slb-success); border: 1px solid var(--slb-success); }
      .slb-badge-lose { background: var(--slb-danger-soft); color: var(--slb-danger); border: 1px solid var(--slb-danger); }
      
      .slb-loading-container {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 100%; width: 100%; color: var(--slb-primary); grid-column: 1/-1;
      }
      .slb-spinner {
        width: 48px; height: 48px; border: 4px solid var(--slb-primary-soft);
        border-top-color: var(--slb-primary); border-radius: 50%;
        animation: slb-spin 1s linear infinite; margin-bottom: 16px;
      }
      @keyframes slb-spin { to { transform: rotate(360deg); } }

      /* Minimized Floating Button */
      #slb-minimized-btn {
        position: fixed; bottom: 20px; right: 20px; z-index: 999999999;
        background: var(--slb-surface); border: 1px solid var(--slb-border); border-radius: 9999px;
        padding: 12px 24px; color: var(--slb-text); font-weight: 600; cursor: pointer;
        box-shadow: var(--slb-shadow);
        display: flex; align-items: center; gap: 8px; transition: transform 0.2s;
      }
      #slb-minimized-btn:hover { transform: scale(1.05); }
      #slb-minimized-btn svg { width: 20px; height: 20px; color: var(--slb-primary); }
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
                    <button id="slb-minimize-btn" title="縮小">X</button>
                    <div class="slb-modal-header">
                        <div>
                            <div class="slb-title-row">
                                <div class="slb-modal-title">自動統計報表</div>
                                <label class="slb-auto-open-label">
                                    <input type="checkbox" id="slb-auto-open-cb" style="-webkit-appearance: checkbox !important; appearance: auto !important; display: inline-block !important; opacity: 1 !important; visibility: visible !important; position: static !important; width: 16px !important; height: 16px !important; margin: 0 !important; cursor: pointer !important;"> 切到我的投注時自動打開
                                </label>
                                <span class="slb-theme-control" aria-label="主題">
                                    <span class="slb-theme-label">主題</span>
                                    <button type="button" id="slb-theme-switch" class="slb-theme-switch" role="switch" aria-checked="false" title="切換淺色模式">
                                        <span class="slb-theme-dark-label">深色</span>
                                        <span class="slb-theme-light-label">淺色</span>
                                    </button>
                                </span>
                            </div>
                            <div class="slb-disclaimer-line">${DISCLAIMER_TEXT}</div>
                            <div class="slb-filter-row">
                                📅 查詢區間：
                                <input type="date" id="slb-date-from" class="slb-date-input">
                                <span>~</span>
                                <input type="date" id="slb-date-to" class="slb-date-input">
                                <button id="slb-date-search" class="slb-date-search-btn">搜尋</button>
                                <button id="slb-date-7d" class="slb-date-shortcut" style="margin-left:4px;">7天</button>
                                <button id="slb-date-30d" class="slb-date-shortcut">30天</button>
                            </div>
                            <div class="slb-filter-row">
                                🏷️ 球類：
                                <div class="slb-sport-filter-options" id="slb-sport-filter-options">
                                    <button type="button" class="slb-sport-filter-btn active" data-sport="ALL">全部</button>
                                </div>
                            </div>
                            <div class="slb-modal-subtitle" id="slb-status-text" style="margin-top: 8px;">正在載入資料...</div>
                        </div>
                        <div class="slb-header-github">
                            <a class="slb-github-button" href="https://github.com/asadman1523/sportlotterycomtw_report" target="_blank" rel="noopener noreferrer" aria-label="Star asadman1523/sportlotterycomtw_report on GitHub" title="Star on GitHub">
                                <span class="slb-github-button-main">
                                    <svg class="slb-github-icon" viewBox="0 0 16 16" aria-hidden="true">
                                        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.969.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.979a.75.75 0 0 1-1.088-.79l.72-4.193L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path>
                                    </svg>
                                    Star
                                </span>
                                <span class="slb-github-button-count" id="slb-github-stars">...</span>
                            </a>
                        </div>
                        <div class="slb-header-export">
                            <span class="slb-result-count" id="slb-result-count">共 0 筆資料</span>
                            <button class="slb-export-btn" id="slb-export-btn" title="匯出 CSV">匯出 CSV</button>
                        </div>
                    </div>
                    <div class="slb-modal-content" id="slb-modal-content">
                        <div class="slb-loading-container">
                            <div class="slb-spinner"></div>
                            <div id="slb-loading-text">正在載入資料...</div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            updateGitHubStars();

            miniBtn = document.createElement("div");
            miniBtn.id = "slb-minimized-btn";
            miniBtn.innerHTML = `
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                台灣運彩投注報表
            `;
            document.body.appendChild(miniBtn);
            applyTheme(getPreferredTheme());
            
            const autoOpenCb = document.getElementById("slb-auto-open-cb");
            const autoOpenPref = localStorage.getItem("slb_auto_open");
            const isAutoOpen = autoOpenPref === null ? true : autoOpenPref === "true";
            autoOpenCb.checked = isAutoOpen;
            
            autoOpenCb.addEventListener("change", (e) => {
                localStorage.setItem("slb_auto_open", e.target.checked ? "true" : "false");
            });

            const themeSwitch = document.getElementById("slb-theme-switch");
            if (themeSwitch) {
                themeSwitch.addEventListener("click", () => {
                    const currentTheme = document.getElementById("slb-modal-overlay")?.dataset.theme || getPreferredTheme();
                    applyTheme(currentTheme === "light" ? "dark" : "light");
                });
            }
            
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

            overlay.addEventListener("click", (e) => {
                if (e.target !== overlay) return;
                overlay.style.display = "none";
                miniBtn.style.display = "flex";
            });

            const exportBtn = document.getElementById("slb-export-btn");
            if (exportBtn) exportBtn.addEventListener("click", exportCSV);

            miniBtn.addEventListener("click", () => {
                miniBtn.style.display = "none";
                overlay.style.display = "flex";
            });

            showDisclaimerNoticeIfNeeded();
            
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

            document.getElementById("slb-date-search").addEventListener("click", async () => {
                if (!await ensureDisclaimerStateLoaded()) {
                    showDisclaimerNotice();
                    return;
                }
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
                broadcastDisclaimerAccepted();
                const frames = document.getElementsByTagName('iframe');
                for (let i = 0; i < frames.length; i++) {
                    frames[i].contentWindow.postMessage({
                        type: 'SLB_FETCH_MANUAL',
                        queryStr: newQs
                    }, '*');
                }
            });

            document.getElementById("slb-date-7d").addEventListener("click", () => {
                const today = new Date();
                const past = new Date(); past.setDate(today.getDate() - 7);
                const formatD = d => d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
                const fromEl = document.getElementById("slb-date-from");
                const toEl = document.getElementById("slb-date-to");
                if(fromEl) fromEl.value = formatD(past);
                if(toEl) toEl.value = formatD(today);
                document.getElementById("slb-date-search").click();
            });

            document.getElementById("slb-date-30d").addEventListener("click", () => {
                const today = new Date();
                const past = new Date(); past.setDate(today.getDate() - 30);
                const formatD = d => d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
                const fromEl = document.getElementById("slb-date-from");
                const toEl = document.getElementById("slb-date-to");
                if(fromEl) fromEl.value = formatD(past);
                if(toEl) toEl.value = formatD(today);
                document.getElementById("slb-date-search").click();
            });
        } else {
            applyTheme(getPreferredTheme());
            overlay.style.display = "flex";
            showDisclaimerNoticeIfNeeded();
        }
    });
  }

  function showDisclaimerNotice() {
      const overlay = document.getElementById("slb-modal-overlay");
      const miniBtn = document.getElementById("slb-minimized-btn");
      if (overlay) overlay.style.display = "flex";
      if (miniBtn) miniBtn.style.display = "none";
      const contentEl = document.getElementById("slb-modal-content");
      if (!contentEl) return;
      contentEl.innerHTML = `
          <div class="slb-disclaimer-panel">
              <div class="slb-disclaimer-card">
                  <h3>使用前請先確認免責聲明</h3>
                  <p>${DISCLAIMER_TEXT}</p>
                  <button id="slb-accept-disclaimer-btn">我已了解並同意使用</button>
              </div>
          </div>
      `;
      const statusEl = document.getElementById("slb-status-text");
      if (statusEl) statusEl.textContent = "請先確認免責聲明後再使用報表功能。";
      const acceptBtn = document.getElementById("slb-accept-disclaimer-btn");
      if (acceptBtn) {
          acceptBtn.addEventListener("click", async () => {
              await saveDisclaimerAccepted();
              broadcastDisclaimerAccepted();
              updateStatus("已確認免責聲明，正在載入報表...");
              contentEl.innerHTML = `
                  <div class="slb-loading-container">
                      <div class="slb-spinner"></div>
                      <div id="slb-loading-text">已確認免責聲明，正在載入報表...</div>
                  </div>
              `;
          });
      }
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
      csvContent += "投注代碼,投注 ID,下注時間,玩法,投注內容,投注額,預計/實際派彩,狀態\n";
      
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
          
          csvContent += `"${b.ticketId || ''}","${b.id || ''}",${createdDate},${b.betTypeName || "單場"},${contentText},${b.totalStake},${displayReturn},${stateText}\n`;
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

      window.originalSLBBets = betsArray;
      updateSportFilterControls();

      window.slbSortCol = window.slbSortCol || 'date';
      if (window.slbSortDesc === undefined) window.slbSortDesc = true;

      const filteredBets = [...betsArray].filter(betMatchesSportFilter);
      const sortedBets = filteredBets.sort((a, b) => {
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

      window.currentSLBBets = sortedBets;
      updateResultCount(sortedBets.length);
      if (sortedBets.length === 0) {
          container.innerHTML = `<div class="slb-empty-state">沒有符合篩選條件的注單記錄。</div>`;
          updateStatus("目前篩選條件沒有注單記錄。");
          return;
      }
      

      function getSortIcon(col) {
          if (window.slbSortCol !== col) return '<span class="slb-sort-icon-muted">↕</span>';
          return window.slbSortDesc ? '<span class="slb-sort-icon-active">↓</span>' : '<span class="slb-sort-icon-active">↑</span>';
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
                      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
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
          
          const metaHtml = `<div class="slb-content-meta" style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; user-select:text; cursor:auto;" onclick="event.stopPropagation();">
              <div><b class="slb-meta-label">投注代碼：</b> ${escapeHTML(b.ticketId || b.id || '無')}</div>
              <div><b class="slb-meta-label">投注 ID：</b> ${escapeHTML(b.id || '無')}</div>
          </div>`;

          if (b.legs && b.legs.length > 0) {
              const htmlLegTexts = b.legs.map(leg => {
                  const ev = escapeHTML(leg.eventName || '未知');
                  const mk = escapeHTML(leg.marketName || '');
                  const sel = escapeHTML(leg.selectionName || '');
                  return `<div class="slb-content-leg">[${ev}] ${mk} - <b>${sel}</b></div>`;
              });
              const plainLegTexts = b.legs.map(leg => {
                  const ev = escapeHTML(leg.eventName || '未知');
                  const mk = escapeHTML(leg.marketName || '');
                  const sel = escapeHTML(leg.selectionName || '');
                  return `[${ev}] ${mk} - ${sel}`;
              });
              contentText = metaHtml + htmlLegTexts.join("");
              fullContentText = plainLegTexts.join("\n");
          } else {
              contentText = metaHtml + "<div class='slb-content-leg'>無法讀取詳細資訊</div>";
              fullContentText = "無法讀取詳細資訊";
          }

          tableHtml += `
              <tr class="slb-row" style="cursor:pointer; transition: background 0.2s;" onclick="const c = this.querySelector('.slb-content'); if(c) c.classList.toggle('expanded');">
                  <td class="slb-date">${createdDate}</td>
                  <td class="slb-type">${escapeHTML(b.betTypeName || "單場")}</td>
                  <td class="slb-content" title="${fullContentText}" onclick="event.stopPropagation(); this.classList.toggle('expanded');">${contentText}</td>
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
                <span class="slb-summary-chip" style="margin-right:8px;">
                    💰 <b>本金去向</b>：總投入 <b>NT$ ${totalBet}</b> = 未派彩 <span class="slb-summary-warning">NT$ ${pendingStake}</span> + 已結算本金 <b>NT$ ${settledBet}</b>
                </span>
            </div>
            <div>
                <span class="slb-summary-chip">
                    🏆 <b>結算戰績</b>：總派彩 <span class="slb-summary-success">NT$ ${settledReturn}</span> - 已結算本金 <b>NT$ ${settledBet}</b> = 淨損益 <b class="${pl >= 0 ? 'slb-summary-success' : 'slb-summary-danger'}">NT$ ${pl}</b>
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
                                      id: item.idFOBet || item.id || betId,
                                      fullExternalReference: betId,
                                      createdDate: item.tsAttempted,
                                      betTypeName: item.betTypeName,
                                      betState: item.betState,
                                      totalStake: item.totalStake || item.wunitStake || 0,
                                      totalReturn: item.betState === 'Open' ? item.potentialReturn : (item.totalReturn || item.discountedTotalReturn || 0),
                                      ticketId: item.idFOBetslip || item.receipt || item.ticketId || item.externalRef || item.shortId || '',
                                      legs: []
                                  });
                              }
                              localDatabase.get(betId).legs.push({
                                  idFOSportType: item.idFOSportType,
                                  idFOSport: item.idFOSport,
                                  tournamentName: item.tournamentName,
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
      
      return {
          bets: localDatabase,
          fromStr: fromStr,
          toStr: toStr
      };
  }
})();
