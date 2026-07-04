(() => {
  "use strict";

  const SUMMARY_CLASS = "slb-bet-summary";
  const betsDatabase = new Map();
  const DISCLAIMER_ACCEPTED_KEY = "slb_disclaimer_accepted_v1";
  const THEME_STORAGE_KEY = "slb_theme";
  const REPORT_PANEL_COLLAPSED_KEY = "slb_report_panel_collapsed";
  const DISCLAIMER_TEXT = "免責聲明：本工具僅供個人記帳與參考，統計結果不代表官方帳務；所有投注紀錄、派彩與結算資訊皆以台灣運彩官方系統為準。本工具與台灣運彩官方無關。";
  const SPORT_LABELS = {
      FBL: "足球",
      BKB: "籃球",
      BSB: "棒球",
      TNS: "網球",
      OTHER: "其他",
  };
  const SPORT_FILTER_ORDER = ["FBL", "BKB", "BSB", "TNS", "OTHER"];
  const PAYOUT_FILTERS = {
      SETTLED: "已派彩",
      PENDING: "未派彩",
  };
  const BET_TYPE_PARLAY_COUNTS = {
      singles: 1,
      double: 2,
      doubles: 2,
      treble: 3,
      trebles: 3,
      "4-folds": 4,
      "5-folds": 5,
      "6-folds": 6,
      "7-folds": 7,
      "8-folds": 8,
      "9-folds": 9,
      "10-folds": 10,
      "11-folds": 11,
      "12-folds": 12,
  };
  const BET_TYPE_DISPLAY_LABELS = {
      accumulator: "全部過關",
      "全部過關": "全部過關",
  };
  const PARLAY_COUNT_LABELS = {
      1: "一關",
      2: "兩關",
      3: "三關",
      4: "四關",
      5: "五關",
      6: "六關",
      7: "七關",
      8: "八關",
      9: "九關",
      10: "十關",
      11: "十一關",
      12: "十二關",
  };
  const SETTLED_BET_STATES = ["Settled", "CashedOut", "Closed", "Won", "Lost", "Void", "Cancelled"];
  const DATE_CHUNK_FETCH_DELAY_MIN_MS = 1000;
  const DATE_CHUNK_FETCH_DELAY_MAX_MS = 2000;
  const LINE_PURCHASE_URL = "https://lin.ee/zsGJ9oT";
  const LINE_LOGO_RESOURCE = "assets/LINE_logo.svg.webp";
  const LICENSE_DEVICE_ID_KEY = "slb_device_id";
  const LICENSE_CODE_KEY = "slb_license_code";
  const LICENSE_PAYLOAD_KEY = "slb_license_payload";
  const LICENSE_CODE_PREFIX = "SLB1";
  const FREE_MAX_LOOKBACK_DAYS = 365;
  const PRO_MAX_LOOKBACK_DAYS = 730;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LICENSE_PUBLIC_JWK = {
      kty: "EC",
      crv: "P-256",
      x: "oQxSKeY749vnhbNsCcb_Wz-STUATErKDJBXsaouM1ww",
      y: "lty1AQ4XHSGcEF3eE3Oov8t35wXGXs1Kb7rP6kiDltE",
      ext: true,
  };
  let cachedApiHeaders = null;
  let cachedApiBaseUrl = null;
  let cachedApiQueryStr = null;
  let activeFetchController = null;
  let activeFetchRunId = "";
  let parentFetchRunId = "";
  let fetchRunCounter = 0;
  let autoCollectTriggered = false;
  let disclaimerAcceptedInThisPage = false;
  let disclaimerStorageLoaded = false;
  let licenseDeviceId = "";
  let licensePayload = null;
  let licenseStateLoaded = false;
  const disclaimerStorageReady = loadDisclaimerAccepted();
  const licenseStateReady = loadLicenseState();

  const TEXT = {
    win: "\u8d0f",
    lose: "\u8f38",
    pending: "\u672a\u6d3e\u5f69",
    voided: "\u9000\u56de",
    legWin: "\u904e",
    legLose: "\u5012",
    legPending: "\u672a\u7d50",
    legVoid: "\u9000",
    unknown: "-",
    bet: "\u6295\u6ce8",
    option: "\u6295\u6ce8\u9078\u9805",
  };

  window.slbSelectedSportTypes = window.slbSelectedSportTypes || [];
  window.slbSelectedPayoutStatuses = window.slbSelectedPayoutStatuses || [];
  window.slbSelectedParlayCounts = window.slbSelectedParlayCounts || [];
  window.slbSelectedParlayTypes = window.slbSelectedParlayTypes || [];

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
                  fetchAndPostData(e.data.queryStr, e.data.fetchRunId);
              }
          }
      }
      
      // When the Parent Window receives the start signal
      if (e.data.type === 'SLB_FETCH_START') {
          if (!location.href.includes("my-bets")) return;
          if (e.data.fetchRunId) parentFetchRunId = e.data.fetchRunId;
          showModal();
          if (!await ensureDisclaimerStateLoaded()) {
              showDisclaimerNotice();
              return;
          }
          updateStatus("");
          updateProgress("");
      }

      if (e.data.type === 'SLB_FETCH_PROGRESS') {
          if (!location.href.includes("my-bets")) return;
          if (e.data.fetchRunId && parentFetchRunId && e.data.fetchRunId !== parentFetchRunId) return;
          showModal();
          if (!await ensureDisclaimerStateLoaded()) {
              showDisclaimerNotice();
              return;
          }
          updateProgressStage(`正在載入分段資料 ${e.data.current}/${e.data.total}（${e.data.fromDate} ~ ${e.data.toDate}）`);
      }

      // When the Parent Window receives the fetched data
      if (e.data.type === 'SLB_DATA_FETCHED') {
          if (!location.href.includes("my-bets")) return;
          if (e.data.fetchRunId && parentFetchRunId && e.data.fetchRunId !== parentFetchRunId) return;
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

          if (e.data.error) {
              updateStatus(`<span class="slb-error-text">API 錯誤: ${e.data.error}</span>`);
              updateProgress("");
          } else {
              if (e.data.partial) {
                  updateProgressLoaded("");
              } else {
                  updateStatus("");
                  updateProgress("");
              }
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

  function storageGet(keys) {
      const storage = getExtensionStorage();
      if (!storage) return Promise.resolve({});
      return new Promise((resolve) => {
          storage.get(keys, (result) => resolve(result || {}));
      });
  }

  function storageSet(values) {
      const storage = getExtensionStorage();
      if (!storage) return Promise.resolve();
      return new Promise((resolve) => {
          storage.set(values, () => resolve());
      });
  }

  function storageRemove(keys) {
      const storage = getExtensionStorage();
      if (!storage) return Promise.resolve();
      return new Promise((resolve) => {
          storage.remove(keys, () => resolve());
      });
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

  function generateDeviceId() {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return `SLB-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  async function getOrCreateDeviceId() {
      const result = await storageGet([LICENSE_DEVICE_ID_KEY]);
      if (typeof result[LICENSE_DEVICE_ID_KEY] === "string" && result[LICENSE_DEVICE_ID_KEY]) {
          return result[LICENSE_DEVICE_ID_KEY];
      }
      const deviceId = generateDeviceId();
      await storageSet({ [LICENSE_DEVICE_ID_KEY]: deviceId });
      return deviceId;
  }

  function base64UrlToBytes(value) {
      const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
  }

  function bytesToText(bytes) {
      return new TextDecoder().decode(bytes);
  }

  function getLicenseSigningBytes(payloadPart) {
      return new TextEncoder().encode(`${LICENSE_CODE_PREFIX}.${payloadPart}`);
  }

  async function verifyLicenseCode(code, deviceId) {
      const trimmedCode = String(code || "").trim();
      const parts = trimmedCode.split(".");
      if (parts.length !== 3 || parts[0] !== LICENSE_CODE_PREFIX) {
          throw new Error("啟動碼格式不正確。");
      }

      let payload;
      try {
          payload = JSON.parse(bytesToText(base64UrlToBytes(parts[1])));
      } catch (e) {
          throw new Error("啟動碼內容無法讀取。");
      }

      if (!payload || payload.plan !== "pro") {
          throw new Error("這組啟動碼不是 Pro 授權。");
      }
      if (payload.deviceId !== deviceId) {
          throw new Error("啟動碼不屬於這台裝置。");
      }

      const publicKey = await crypto.subtle.importKey(
          "jwk",
          LICENSE_PUBLIC_JWK,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"]
      );
      const signatureOk = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          publicKey,
          base64UrlToBytes(parts[2]),
          getLicenseSigningBytes(parts[1])
      );
      if (!signatureOk) {
          throw new Error("啟動碼簽章驗證失敗。");
      }

      return payload;
  }

  async function loadLicenseState() {
      try {
          licenseDeviceId = await getOrCreateDeviceId();
          const result = await storageGet([LICENSE_CODE_KEY, LICENSE_PAYLOAD_KEY]);
          if (typeof result[LICENSE_CODE_KEY] === "string" && result[LICENSE_CODE_KEY]) {
              licensePayload = await verifyLicenseCode(result[LICENSE_CODE_KEY], licenseDeviceId);
              await storageSet({ [LICENSE_PAYLOAD_KEY]: licensePayload });
          } else {
              licensePayload = null;
              await storageRemove([LICENSE_PAYLOAD_KEY]);
          }
      } catch (e) {
          licensePayload = null;
          await storageRemove([LICENSE_CODE_KEY, LICENSE_PAYLOAD_KEY]);
      } finally {
          licenseStateLoaded = true;
          updateProUi();
      }
      return isProUnlocked();
  }

  async function ensureLicenseStateLoaded() {
      if (!licenseStateLoaded) await licenseStateReady;
      return isProUnlocked();
  }

  function isProUnlocked() {
      return licensePayload?.plan === "pro" && licensePayload?.deviceId === licenseDeviceId;
  }

  async function activateLicenseCode(code) {
      const deviceId = await getOrCreateDeviceId();
      const payload = await verifyLicenseCode(code, deviceId);
      licenseDeviceId = deviceId;
      licensePayload = payload;
      licenseStateLoaded = true;
      await storageSet({
          [LICENSE_DEVICE_ID_KEY]: deviceId,
          [LICENSE_CODE_KEY]: String(code || "").trim(),
          [LICENSE_PAYLOAD_KEY]: payload,
      });
      updateProUi();
      return payload;
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

  function isFetchCancelledError(error) {
      return error?.name === "AbortError" || error?.message === "SLB_FETCH_CANCELLED";
  }

  async function fetchAndPostData(queryStr, requestedRunId) {
      if (!cachedApiBaseUrl || !cachedApiHeaders) return;
      const access = await getDateRangeAccess(queryStr);
      if (!access.allowed) {
          if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'SLB_DATA_FETCHED', fetchRunId: requestedRunId, error: access.message }, '*');
          }
          return;
      }

      if (activeFetchController) {
          activeFetchController.abort();
      }

      const fetchRunId = requestedRunId || `auto-${Date.now()}-${++fetchRunCounter}`;
      const fetchController = new AbortController();
      activeFetchController = fetchController;
      activeFetchRunId = fetchRunId;

      if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'SLB_FETCH_START', fetchRunId }, '*');
      }

      try {
          const fetchResult = await fetchAllDataNatively(cachedApiBaseUrl, cachedApiHeaders, queryStr, {
              fetchRunId,
              signal: fetchController.signal
          });
          if (fetchController.signal.aborted || fetchRunId !== activeFetchRunId) return;
          if (window.parent && window.parent !== window) {
              window.parent.postMessage({
                  type: 'SLB_DATA_FETCHED',
                  fetchRunId,
                  bets: Array.from(fetchResult.bets.values()),
                  fromStr: fetchResult.fromStr,
                  toStr: fetchResult.toStr
              }, '*');
          }
      } catch (error) {
          if (!isFetchCancelledError(error) && window.parent && window.parent !== window && fetchRunId === activeFetchRunId) {
              window.parent.postMessage({ type: 'SLB_DATA_FETCHED', fetchRunId, error: error?.message || "Fetch failed" }, '*');
          }
      } finally {
          if (fetchRunId === activeFetchRunId) {
              activeFetchController = null;
              activeFetchRunId = "";
          }
      }
  }

  function startOfLocalDay(value) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function parseQueryDateRange(queryStr) {
      if (!queryStr) return null;
      try {
          const params = new URLSearchParams(queryStr);
          const from = params.get("from");
          const to = params.get("to");
          if (!from || !to) return null;
          const fromDate = new Date(from);
          const toDate = new Date(to);
          if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
          return { fromDate, toDate };
      } catch (e) {
          return null;
      }
  }

  function getOldestAllowedDate(days) {
      const oldest = startOfLocalDay(new Date());
      oldest.setDate(oldest.getDate() - days);
      return oldest;
  }

  function getRangeDays(fromDate, toDate) {
      return Math.floor((startOfLocalDay(toDate).getTime() - startOfLocalDay(fromDate).getTime()) / DAY_MS);
  }

  async function getDateRangeAccess(queryStr) {
      const range = parseQueryDateRange(queryStr);
      if (!range) return { allowed: true };
      if (range.fromDate > range.toDate) {
          return { allowed: false, type: "error", message: "查詢起日不可晚於迄日。" };
      }

      await ensureLicenseStateLoaded();
      const pro = isProUnlocked();
      const fromDay = startOfLocalDay(range.fromDate);
      const rangeDays = getRangeDays(range.fromDate, range.toDate);
      if (!pro) {
          const freeOldest = getOldestAllowedDate(FREE_MAX_LOOKBACK_DAYS);
          if (fromDay < freeOldest || rangeDays > FREE_MAX_LOOKBACK_DAYS) {
              return {
                  allowed: false,
                  type: "pro",
                  message: "查詢超過一年屬於 Pro 功能。升級後可查詢最近二年內投注資料。",
              };
          }
      }

      const proOldest = getOldestAllowedDate(PRO_MAX_LOOKBACK_DAYS);
      if (fromDay < proOldest || rangeDays > PRO_MAX_LOOKBACK_DAYS) {
          return { allowed: false, type: "error", message: "目前最多支援查詢最近二年內的投注資料。" };
      }

      return { allowed: true };
  }

  function setDateLimitError(message) {
      showModal();
      updateStatus(`<span class="slb-error-text">${message}</span>`);
      updateProgress("");
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

  function isSettledBet(bet) {
      return SETTLED_BET_STATES.includes(bet.betState);
  }

  function getPayoutStatus(bet) {
      return isSettledBet(bet) ? "SETTLED" : "PENDING";
  }

  function parseChineseParlayCount(text) {
      const digits = {
          一: 1,
          二: 2,
          兩: 2,
          三: 3,
          四: 4,
          五: 5,
          六: 6,
          七: 7,
          八: 8,
          九: 9,
      };
      if (!text) return null;
      if (text === "十") return 10;
      if (text.includes("十")) {
          const [tenText, oneText] = text.split("十");
          const tens = tenText ? digits[tenText] : 1;
          const ones = oneText ? digits[oneText] : 0;
          const count = tens * 10 + ones;
          return Number.isFinite(count) && count > 0 ? count : null;
      }
      return digits[text] || null;
  }

  function getParlayCountFromTypeName(betTypeName) {
      const typeName = String(betTypeName || "").trim();
      const mappedCount = BET_TYPE_PARLAY_COUNTS[typeName.toLowerCase()];
      if (mappedCount) return mappedCount;

      const digitMatch = typeName.match(/(\d+)\s*關/);
      if (digitMatch) {
          const count = Number(digitMatch[1]);
          if (Number.isFinite(count) && count > 0) return count;
      }

      const chineseMatch = typeName.match(/([一二兩三四五六七八九十]+)\s*關/);
      const chineseCount = parseChineseParlayCount(chineseMatch?.[1] || "");
      return chineseCount || null;
  }

  function isAccumulatorBetType(betTypeName) {
      const typeName = String(betTypeName || "").trim();
      return typeName.toLowerCase() === "accumulator" || typeName === "全部過關";
  }

  function getBetParlayCount(bet) {
      if (isAccumulatorBetType(bet?.betTypeName)) return null;
      return getParlayCountFromTypeName(bet?.betTypeName) || 1;
  }

  function formatParlayCountLabel(count) {
      return PARLAY_COUNT_LABELS[count] || `${count}關`;
  }

  function getBetTypeNameDisplay(betTypeName) {
      const mappedLabel = BET_TYPE_DISPLAY_LABELS[String(betTypeName || "").trim().toLowerCase()];
      if (mappedLabel) return mappedLabel;

      const count = getParlayCountFromTypeName(betTypeName);
      if (count) return formatParlayCountLabel(count);
      return String(betTypeName || "").trim() || "單場";
  }

  function getAvailableParlayCounts(bets) {
      const counts = new Set();
      (bets || []).forEach((bet) => {
          counts.add(getBetParlayCount(bet));
      });
      return [...counts]
          .filter((count) => Number.isFinite(count) && count > 0)
          .sort((a, b) => a - b);
  }

  function hasAccumulatorBets(bets) {
      return (bets || []).some((bet) => isAccumulatorBetType(bet?.betTypeName));
  }

  function getLegStatusKey(leg) {
      const rawStatus = String(leg?.betLegStatus || "").trim().toLowerCase();
      const rawOutcome = String(leg?.winWLDOutcome || "").trim().toUpperCase();
      if (["won", "win"].includes(rawStatus) || rawOutcome === "W") return "WON";
      if (["lost", "lose"].includes(rawStatus) || rawOutcome === "L") return "LOST";
      if (["void", "voided", "cancelled", "canceled", "refund", "refunded", "push"].includes(rawStatus) || ["V", "P", "R"].includes(rawOutcome)) return "VOID";
      if (rawStatus === "open" || rawStatus === "pending" || rawOutcome === "O") return "OPEN";
      return "UNKNOWN";
  }

  function getLegStatusMeta(leg) {
      const status = getLegStatusKey(leg);
      if (status === "WON") return { text: TEXT.legWin, className: "slb-leg-status-icon-win" };
      if (status === "LOST") return { text: TEXT.legLose, className: "slb-leg-status-icon-lose" };
      if (status === "VOID") return { text: TEXT.legVoid, className: "slb-leg-status-icon-void" };
      if (status === "OPEN") return { text: TEXT.legPending, className: "slb-leg-status-icon-pending" };
      return { text: "", className: "" };
  }

  function betMatchesPayoutFilter(bet) {
      const selected = window.slbSelectedPayoutStatuses || [];
      if (selected.length === 0) return true;
      return selected.includes(getPayoutStatus(bet));
  }

  function betMatchesParlayCountFilter(bet) {
      const selected = window.slbSelectedParlayCounts || [];
      const selectedTypes = window.slbSelectedParlayTypes || [];
      if (!isProUnlocked()) return true;
      if (selectedTypes.includes("ACCUMULATOR")) return isAccumulatorBetType(bet?.betTypeName);
      if (selected.length === 0) return true;
      if (isAccumulatorBetType(bet?.betTypeName)) return false;
      return selected.includes(getBetParlayCount(bet));
  }

  function getBetOddsValue(bet) {
      const odds = Number(bet.odds ?? bet.totalMultiBetOdds);
      if (Number.isFinite(odds) && odds > 0) return odds;
      if (Array.isArray(bet.legs) && bet.legs.length === 1) {
          return getLegOddsValue(bet.legs[0]);
      }
      return null;
  }

  function getDecimalOddsFromFraction(up, down) {
      const upValue = Number(up);
      const downValue = Number(down);
      if (!Number.isFinite(upValue) || !Number.isFinite(downValue) || downValue <= 0) return null;
      const odds = 1 + (upValue / downValue);
      return Number.isFinite(odds) && odds >= 1 ? odds : null;
  }

  function getItemOddsValue(item) {
      return getDecimalOddsFromFraction(item.ownPriceUp, item.ownPriceDown)
          ?? getDecimalOddsFromFraction(item.settlementpriceup, item.settlementpricedown)
          ?? getDecimalOddsFromFraction(item.ownMultiPriceUp, item.ownMultiPriceDown);
  }

  function getLegOddsValue(leg) {
      const odds = Number(leg && leg.odds);
      return Number.isFinite(odds) && odds > 0 ? odds : null;
  }

  function isMultiSingleBet(bet) {
      return getParlayCountFromTypeName(bet?.betTypeName) === 1 && Array.isArray(bet.legs) && bet.legs.length > 1;
  }

  function getBetTypeDisplay(bet) {
      const typeName = getBetTypeNameDisplay(bet?.betTypeName);
      return isMultiSingleBet(bet) ? `${typeName} x${bet.legs.length}` : typeName;
  }

  function getBetOddsDisplay(bet) {
      if (isMultiSingleBet(bet)) {
          const legOdds = bet.legs
              .map((leg) => getLegOddsValue(leg))
              .filter((odds) => odds !== null);
          if (legOdds.length > 0) return legOdds.map(formatOdds).join(" / ");
      }
      return formatOdds(getBetOddsValue(bet));
  }

  function formatCurrency(amount) {
      const value = Number(amount);
      return Number.isFinite(value) ? `NT$ ${value}` : "-";
  }

  function getActualReturnDisplay(bet) {
      return isSettledBet(bet) ? formatCurrency(bet.totalReturn || 0) : "-";
  }

  function getNetProfitLoss(bet) {
      if (!isSettledBet(bet)) return null;
      return (Number(bet.totalReturn) || 0) - (Number(bet.totalStake) || 0);
  }

  function getNetProfitLossDisplay(bet) {
      const profitLoss = getNetProfitLoss(bet);
      return profitLoss === null ? "-" : formatCurrency(profitLoss);
  }

  function getReturnProfitText(bet) {
      return `${getActualReturnDisplay(bet)} / ${getNetProfitLossDisplay(bet)}`;
  }

  function getProfitLossClass(bet) {
      const profitLoss = getNetProfitLoss(bet);
      if (profitLoss === null) return "";
      return profitLoss >= 0 ? "slb-summary-success" : "slb-summary-danger";
  }

  function formatOdds(odds) {
      return odds === null ? "-" : odds.toFixed(2);
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

  function updatePayoutFilterControls() {
      const optionsEl = document.getElementById("slb-payout-filter-options");
      if (!optionsEl) return;

      const activeSelected = new Set(window.slbSelectedPayoutStatuses || []);
      const allActive = activeSelected.size === 0;
      const buttonsHtml = [
          `<button type="button" class="slb-sport-filter-btn ${allActive ? "active" : ""}" data-payout="ALL">全部</button>`,
          ...Object.entries(PAYOUT_FILTERS).map(([status, label]) =>
              `<button type="button" class="slb-sport-filter-btn ${activeSelected.has(status) ? "active" : ""}" data-payout="${status}">${label}</button>`
          ),
      ].join("");

      optionsEl.innerHTML = buttonsHtml;
      optionsEl.querySelectorAll(".slb-sport-filter-btn").forEach((button) => {
          button.addEventListener("click", () => {
              const status = button.getAttribute("data-payout");
              if (status === "ALL") {
                  window.slbSelectedPayoutStatuses = [];
              } else {
                  const currentSelected = window.slbSelectedPayoutStatuses || [];
                  window.slbSelectedPayoutStatuses = currentSelected.length === 1 && currentSelected[0] === status ? [] : [status];
              }
              if (window.originalSLBBets) renderBets(window.originalSLBBets);
          });
      });
  }

  function updateParlayCountFilterControls() {
      const optionsEl = document.getElementById("slb-parlay-count-filter-options");
      if (!optionsEl) return;

      const availableCounts = getAvailableParlayCounts(window.originalSLBBets || []);
      const availableSet = new Set(availableCounts);
      const hasAccumulator = hasAccumulatorBets(window.originalSLBBets || []);
      const activeTypes = isProUnlocked() && hasAccumulator && (window.slbSelectedParlayTypes || []).includes("ACCUMULATOR") ? ["ACCUMULATOR"] : [];
      const selectedCounts = isProUnlocked() ? (window.slbSelectedParlayCounts || []) : [];
      const activeCounts = activeTypes.length > 0 ? [] : selectedCounts
          .map((count) => Number(count))
          .filter((count) => availableSet.has(count));
      window.slbSelectedParlayTypes = activeTypes;
      window.slbSelectedParlayCounts = activeCounts.length > 0 ? [activeCounts[0]] : [];

      const activeSelected = new Set(window.slbSelectedParlayCounts);
      const activeTypeSelected = new Set(window.slbSelectedParlayTypes);
      const allActive = activeSelected.size === 0 && activeTypeSelected.size === 0;
      const buttonsHtml = [
          `<button type="button" class="slb-sport-filter-btn ${allActive ? "active" : ""}" data-parlay-count="ALL">全部</button>`,
          hasAccumulator ? `<button type="button" class="slb-sport-filter-btn slb-date-shortcut-pro ${activeTypeSelected.has("ACCUMULATOR") ? "active" : ""}" data-parlay-type="ACCUMULATOR">全部過關<span class="slb-pro-flag">PRO</span></button>` : "",
          ...availableCounts.map((count) =>
              `<button type="button" class="slb-sport-filter-btn slb-date-shortcut-pro ${activeSelected.has(count) ? "active" : ""}" data-parlay-count="${count}">${formatParlayCountLabel(count)}<span class="slb-pro-flag">PRO</span></button>`
          ),
      ].join("");

      optionsEl.innerHTML = buttonsHtml;
      optionsEl.querySelectorAll(".slb-sport-filter-btn").forEach((button) => {
          button.addEventListener("click", async () => {
              const parlayCount = button.getAttribute("data-parlay-count");
              const parlayType = button.getAttribute("data-parlay-type");
              if (parlayCount === "ALL") {
                  window.slbSelectedParlayCounts = [];
                  window.slbSelectedParlayTypes = [];
                  if (window.originalSLBBets) renderBets(window.originalSLBBets);
                  return;
              }

              if (!await ensureLicenseStateLoaded()) {
                  showProPrompt("過關數篩選屬於 Pro 功能。");
                  return;
              }
              if (parlayType === "ACCUMULATOR") {
                  const currentSelected = window.slbSelectedParlayTypes || [];
                  window.slbSelectedParlayTypes = currentSelected.includes("ACCUMULATOR") ? [] : ["ACCUMULATOR"];
                  window.slbSelectedParlayCounts = [];
                  if (window.originalSLBBets) renderBets(window.originalSLBBets);
                  return;
              }
              const count = Number(parlayCount);
              const currentSelected = window.slbSelectedParlayCounts || [];
              window.slbSelectedParlayCounts = currentSelected.length === 1 && currentSelected[0] === count ? [] : [count];
              window.slbSelectedParlayTypes = [];
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
      const proPrompt = document.getElementById("slb-pro-prompt");

      if (overlay) overlay.dataset.theme = nextTheme;
      if (miniBtn) miniBtn.dataset.theme = nextTheme;
      if (proPrompt) proPrompt.dataset.theme = nextTheme;
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
      #slb-pro-prompt,
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
      #slb-pro-prompt[data-theme="light"],
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
      .slb-report-toggle {
        display: inline-flex; align-items: center; gap: 6px;
        color: var(--slb-text-secondary); font-size: 14px; font-weight: 700;
        cursor: pointer; user-select: none;
      }
      .slb-report-toggle:hover {
        color: var(--slb-text);
      }
      .slb-header-status {
        flex: 1 1 280px;
        min-width: 240px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .slb-report-panel {
        margin-top: 8px;
      }
      .slb-report-panel.collapsed {
        display: none;
      }
      .slb-modal-subtitle {
        min-height: 20px;
        margin-top: 8px;
        color: var(--slb-text-muted);
        font-size: 14px;
        line-height: 20px;
      }
      .slb-header-status .slb-modal-subtitle {
        min-height: 18px;
        margin: 0;
        font-size: 13px;
        line-height: 18px;
      }
      .slb-progress-text,
      .slb-header-progress-text {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 18px;
        margin: 0;
        color: var(--slb-text-secondary);
        font-size: 12px;
        line-height: 18px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .slb-progress-text.is-visible,
      .slb-header-progress-text.is-visible {
        color: var(--slb-warning);
      }
      .slb-progress-stage,
      .slb-header-progress-stage,
      .slb-progress-loaded {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .slb-progress-stage,
      .slb-header-progress-stage {
        flex: 1 1 auto;
      }
      .slb-progress-loaded,
      .slb-header-progress-loaded {
        flex: 0 0 auto;
        color: var(--slb-text-secondary);
      }
      .slb-filter-row {
        margin-top: 8px; font-size: 14px; color: var(--slb-text-secondary);
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      }
      .slb-filter-inline-label {
        display: inline-flex; align-items: center; margin-left: 12px;
      }
      .slb-sport-filter-options {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      }
      .slb-sport-filter-btn {
        position: relative;
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
      .slb-summary-row {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      }
      .slb-summary-warning { color: var(--slb-warning); }
      .slb-summary-success { color: var(--slb-success); }
      .slb-summary-danger { color: var(--slb-danger); }
      .slb-error-text { color: var(--slb-danger); }
      .slb-license-status {
        display: inline-flex; align-items: center; justify-content: center;
        height: 24px; padding: 0 8px; border-radius: 9999px;
        background: var(--slb-chip-bg); color: var(--slb-text-muted);
        border: 1px solid var(--slb-border); font-size: 12px; font-weight: 800;
      }
      .slb-license-status.pro {
        background: var(--slb-warning-soft); color: var(--slb-warning);
        border-color: rgba(244,183,64,0.44);
      }
      .slb-empty-state {
        grid-column: 1/-1; text-align: center; padding: 40px; color: var(--slb-text-muted);
      }
      .slb-date-shortcut {
        position: relative;
        background: var(--slb-surface-alt); color: var(--slb-text-secondary);
        border: 1px solid var(--slb-border-strong); border-radius: 6px;
        height: 28px; padding: 0 9px; font-size: 13px; line-height: 26px;
        font-weight: 600; cursor: pointer;
      }
      .slb-date-shortcut-pro {
        overflow: hidden;
      }
      .slb-pro-flag {
        position: absolute; top: 0; right: 0;
        width: 18px; height: 6px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--slb-warning); color: #111827;
        border-radius: 0 5px 0 3px;
        font-size: 5px; line-height: 6px; font-weight: 900;
        letter-spacing: 0;
        pointer-events: none;
      }
      .slb-date-shortcut:hover {
        background: var(--slb-hover); color: var(--slb-text);
      }
      .slb-theme-control {
        display: inline-flex; align-items: center; gap: 8px;
        color: var(--slb-text-muted); font-size: 14px; white-space: nowrap;
      }
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
      .slb-copy-head,
      .slb-copy-cell {
        width: 44px; min-width: 44px; max-width: 44px;
        padding-left: 4px !important; padding-right: 8px !important;
      }
      .slb-copy-row-btn {
        width: 28px; height: 28px; border-radius: 6px;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; border: 1px solid transparent;
        color: var(--slb-text-muted); cursor: pointer;
        opacity: 0; transform: translateX(4px);
        transition: opacity 0.16s ease, transform 0.16s ease, color 0.16s ease, background 0.16s ease, border-color 0.16s ease;
      }
      .slb-row:hover .slb-copy-row-btn,
      .slb-copy-row-btn:focus-visible {
        opacity: 1; transform: translateX(0);
      }
      .slb-copy-row-btn:hover {
        background: var(--slb-chip-bg); border-color: var(--slb-border-strong);
        color: var(--slb-text);
      }
      .slb-copy-row-btn.copied {
        opacity: 1; transform: translateX(0);
        color: var(--slb-success); border-color: var(--slb-success);
        background: var(--slb-success-soft);
      }
      .slb-copy-row-btn.copied .slb-copy-icon {
        display: none;
      }
      .slb-copy-row-btn.copied::before {
        content: "✓"; font-size: 15px; font-weight: 800;
      }
      .slb-copy-icon {
        width: 15px; height: 15px; stroke: currentColor; fill: none;
        stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
      }
      .slb-date { font-size: 13px; color: var(--slb-text-muted); white-space: nowrap; }
      .slb-table th, .slb-table td {
        padding: 12px; text-align: center; border-bottom: 1px solid var(--slb-border);
      }
      .slb-content {
        max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        color: var(--slb-text-secondary); cursor: pointer; transition: color 0.2s;
      }
      .slb-table td.slb-content {
        text-align: left;
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
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-bottom: 6px;
        padding-bottom: 6px;
        border-bottom: 1px dashed var(--slb-border-strong);
      }
      .slb-content.expanded div.slb-content-leg:last-child {
        border-bottom: none;
        margin-bottom: 0;
        padding-bottom: 0;
      }
      .slb-leg-odds {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--slb-chip-bg);
        color: var(--slb-text-secondary);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }
      .slb-leg-status-icon {
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-right: 6px;
        vertical-align: -3px;
        font-size: 12px;
        font-weight: 900;
        line-height: 1;
        box-sizing: border-box;
        flex: 0 0 auto;
        position: relative;
      }
      .slb-content.expanded .slb-leg-status-icon {
        margin-top: 2px;
        margin-right: 0;
      }
      .slb-leg-status-icon-win { background: var(--slb-success-soft); color: var(--slb-success); border: 1px solid var(--slb-success); }
      .slb-leg-status-icon-win::before { content: "\\2713"; }
      .slb-leg-status-icon-lose { background: var(--slb-danger-soft); color: var(--slb-danger); border: 1px solid var(--slb-danger); }
      .slb-leg-status-icon-lose::before,
      .slb-leg-status-icon-lose::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 9px;
        height: 1.5px;
        border-radius: 9999px;
        background: currentColor;
        transform-origin: center;
      }
      .slb-leg-status-icon-lose::before { transform: translate(-50%, -50%) rotate(45deg); }
      .slb-leg-status-icon-lose::after { transform: translate(-50%, -50%) rotate(-45deg); }
      .slb-leg-status-icon-pending { background: transparent; border: 1px dashed var(--slb-text-muted); }
      .slb-leg-status-icon-void { background: var(--slb-chip-bg); color: var(--slb-text-muted); border: 1px solid var(--slb-border-strong); }
      .slb-leg-status-icon-void::before { content: "-"; }
      .slb-leg-line {
        min-width: 0;
      }
      .slb-leg-result {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 4px;
        background: var(--slb-chip-bg);
        color: var(--slb-text-muted);
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
      }
      .slb-content:not(.expanded) .slb-leg-result {
        display: none;
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
      .slb-return-profit {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        line-height: 1;
        white-space: nowrap;
      }
      .slb-return-profit-separator {
        color: var(--slb-text-muted);
      }
      
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
      #slb-pro-prompt {
        position: fixed; inset: 0; z-index: 1000000001;
        display: flex; align-items: center; justify-content: center;
        background: var(--slb-overlay, rgba(8,20,40,0.86)); backdrop-filter: blur(5px);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: var(--slb-text, #f4f7fa);
      }
      .slb-pro-dialog {
        position: relative;
        width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto;
        background: var(--slb-surface, #172033); color: var(--slb-text, #f4f7fa);
        border: 1px solid var(--slb-border, #334155); border-radius: 8px;
        box-shadow: var(--slb-shadow, 0 25px 50px -12px rgba(8,20,40,0.58)); padding: 22px;
        padding-top: 24px;
      }
      .slb-pro-title {
        margin: 0 40px 8px 0; font-size: 20px; font-weight: 800;
      }
      .slb-pro-close {
        position: absolute; top: 12px; right: 12px;
        width: 32px; height: 32px; border-radius: 6px;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; color: var(--slb-text-muted);
        border: 1px solid transparent; font-size: 22px; line-height: 1;
        font-weight: 500; cursor: pointer;
      }
      .slb-pro-close:hover {
        color: var(--slb-text); background: var(--slb-chip-bg);
        border-color: var(--slb-border-strong);
      }
      .slb-pro-copy {
        margin: 0 0 14px; color: var(--slb-text-secondary); font-size: 14px; line-height: 1.6;
      }
      .slb-pro-actions,
      .slb-pro-field-row {
        display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      }
      .slb-line-actions {
        display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;
      }
      .slb-line-logo-link {
        width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
        border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.18);
        background: #06c755; text-decoration: none;
      }
      .slb-line-logo {
        width: 36px; height: 36px; display: block; object-fit: cover;
      }
      .slb-pro-device,
      .slb-pro-license-input {
        width: 100%; min-width: 0; box-sizing: border-box;
        background: var(--slb-bg); color: var(--slb-text);
        border: 1px solid var(--slb-border-strong); border-radius: 6px;
        padding: 8px 10px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      .slb-pro-device {
        flex: 1 1 260px; width: auto;
      }
      .slb-pro-license-input {
        min-height: 78px; resize: vertical;
      }
      .slb-pro-button,
      .slb-pro-link {
        display: inline-flex; align-items: center; justify-content: center;
        height: 32px; padding: 0 12px; border-radius: 6px;
        font-size: 13px; font-weight: 800; cursor: pointer; text-decoration: none;
      }
      .slb-pro-link,
      .slb-pro-button.primary {
        background: var(--slb-primary); color: #fff; border: 1px solid var(--slb-primary);
      }
      .slb-pro-button.secondary {
        background: var(--slb-surface-alt); color: var(--slb-text);
        border: 1px solid var(--slb-border-strong);
      }
      .slb-pro-button.copied {
        background: var(--slb-success-soft); color: var(--slb-success);
        border-color: var(--slb-success);
      }
      .slb-pro-status {
        min-height: 20px; margin-top: 10px; font-size: 13px; color: var(--slb-text-muted);
      }
      .slb-pro-status.success { color: var(--slb-success); }
      .slb-pro-status.error { color: var(--slb-danger); }
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
                                <span id="slb-license-status" class="slb-license-status">FREE</span>
                                <label class="slb-auto-open-label">
                                    <input type="checkbox" id="slb-auto-open-cb" style="-webkit-appearance: checkbox !important; appearance: auto !important; display: inline-block !important; opacity: 1 !important; visibility: visible !important; position: static !important; width: 16px !important; height: 16px !important; margin: 0 !important; cursor: pointer !important;"> 切到我的投注時自動打開
                                </label>
                                <span class="slb-theme-control" aria-label="主題">
                                    <button type="button" id="slb-theme-switch" class="slb-theme-switch" role="switch" aria-checked="false" title="切換淺色模式">
                                        <span class="slb-theme-dark-label">深色</span>
                                        <span class="slb-theme-light-label">淺色</span>
                                    </button>
                                </span>
                                <div id="slb-report-toggle" class="slb-report-toggle" role="button" tabindex="0" aria-expanded="true" title="收合查詢、篩選與統計">摺疊▼</div>
                                <div class="slb-header-status">
                                    <div class="slb-modal-subtitle" id="slb-header-status-text"></div>
                                    <div class="slb-header-progress-text" id="slb-header-progress-text" aria-live="polite">
                                        <span class="slb-header-progress-stage" id="slb-header-progress-stage"></span>
                                        <span class="slb-header-progress-loaded" id="slb-header-progress-loaded"></span>
                                    </div>
                                </div>
                            </div>
                            <div class="slb-disclaimer-line">${DISCLAIMER_TEXT}</div>
                            <div id="slb-report-panel" class="slb-report-panel">
                                <div class="slb-filter-row">
                                    📅 查詢區間：
                                    <input type="date" id="slb-date-from" class="slb-date-input">
                                    <span>~</span>
                                    <input type="date" id="slb-date-to" class="slb-date-input">
                                    <button id="slb-date-search" class="slb-date-search-btn">搜尋</button>
                                    <button id="slb-date-1h" class="slb-date-shortcut slb-date-shortcut-pro" style="margin-left:4px;">1小時<span class="slb-pro-flag">PRO</span></button>
                                    <button id="slb-date-3h" class="slb-date-shortcut slb-date-shortcut-pro">3小時<span class="slb-pro-flag">PRO</span></button>
                                    <button id="slb-date-6h" class="slb-date-shortcut slb-date-shortcut-pro">6小時<span class="slb-pro-flag">PRO</span></button>
                                    <button id="slb-date-12h" class="slb-date-shortcut slb-date-shortcut-pro">12小時<span class="slb-pro-flag">PRO</span></button>
                                    <button id="slb-date-24h" class="slb-date-shortcut">24小時</button>
                                    <button id="slb-date-7d" class="slb-date-shortcut">7天</button>
                                    <button id="slb-date-30d" class="slb-date-shortcut">30天</button>
                                </div>
                                <div class="slb-filter-row">
                                    🏷️ 球類：
                                    <div class="slb-sport-filter-options" id="slb-sport-filter-options">
                                        <button type="button" class="slb-sport-filter-btn active" data-sport="ALL">全部</button>
                                    </div>
                                    <span class="slb-filter-inline-label">💳 派彩狀態：</span>
                                    <div class="slb-sport-filter-options" id="slb-payout-filter-options">
                                        <button type="button" class="slb-sport-filter-btn active" data-payout="ALL">全部</button>
                                        <button type="button" class="slb-sport-filter-btn" data-payout="SETTLED">已派彩</button>
                                        <button type="button" class="slb-sport-filter-btn" data-payout="PENDING">未派彩</button>
                                    </div>
                                    <span class="slb-filter-inline-label">過關數：</span>
                                    <div class="slb-sport-filter-options" id="slb-parlay-count-filter-options">
                                        <button type="button" class="slb-sport-filter-btn active" data-parlay-count="ALL">全部</button>
                                    </div>
                                </div>
                                <div class="slb-modal-subtitle" id="slb-status-text"></div>
                            </div>
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
                            <div id="slb-loading-text">資料載入中...</div>
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

            const reportPanel = document.getElementById("slb-report-panel");
            const reportToggle = document.getElementById("slb-report-toggle");
            const setReportPanelCollapsed = (collapsed) => {
                if (!reportPanel || !reportToggle) return;
                reportPanel.classList.toggle("collapsed", collapsed);
                reportToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
                reportToggle.setAttribute("title", collapsed ? "展開查詢、篩選與統計" : "收合查詢、篩選與統計");
                reportToggle.textContent = collapsed ? "展開▲" : "摺疊▼";
            };
            if (reportPanel && reportToggle) {
                const collapsedPref = localStorage.getItem(REPORT_PANEL_COLLAPSED_KEY) === "true";
                setReportPanelCollapsed(collapsedPref);
                const toggleReportPanel = () => {
                    const nextCollapsed = reportToggle.getAttribute("aria-expanded") === "true";
                    localStorage.setItem(REPORT_PANEL_COLLAPSED_KEY, nextCollapsed ? "true" : "false");
                    setReportPanelCollapsed(nextCollapsed);
                };
                reportToggle.addEventListener("click", toggleReportPanel);
                reportToggle.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggleReportPanel();
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

            ensureLicenseStateLoaded().then(() => updateProUi());
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

            const formatD = d => d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
            const formatDateTime = d => `${formatD(d)}T${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
            const fetchManualQuery = async (queryStr) => {
                if (!await ensureDisclaimerStateLoaded()) {
                    showDisclaimerNotice();
                    return;
                }

                const access = await getDateRangeAccess(queryStr);
                if (!access.allowed) {
                    if (access.type === "pro") showProPrompt(access.message);
                    else setDateLimitError(access.message);
                    return;
                }

                const fetchRunId = `manual-${Date.now()}-${++fetchRunCounter}`;
                parentFetchRunId = fetchRunId;
                const statusEl = document.getElementById("slb-header-status-text");
                if(statusEl) statusEl.innerHTML = "";
                updateProgress("");

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
                        fetchRunId,
                        queryStr
                    }, '*');
                }
            };

            document.getElementById("slb-date-search").addEventListener("click", async () => {
                const fv = document.getElementById("slb-date-from").value;
                const tv = document.getElementById("slb-date-to").value;
                if (!fv || !tv) return;

                await fetchManualQuery(`from=${fv}T00:00:00.000&to=${tv}T23:59:59.999`);
            });

            const setupHourShortcutButton = (buttonId, hours, requiresPro = false) => {
                const button = document.getElementById(buttonId);
                if (!button) return;
                button.addEventListener("click", async () => {
                    if (requiresPro && !await ensureLicenseStateLoaded()) {
                        showProPrompt(`${hours}小時快捷查詢屬於 Pro 功能。`);
                        return;
                    }
                    const now = new Date();
                    const past = new Date(now.getTime() - hours * 60 * 60 * 1000);
                    const fromEl = document.getElementById("slb-date-from");
                    const toEl = document.getElementById("slb-date-to");
                    if(fromEl) fromEl.value = formatD(past);
                    if(toEl) toEl.value = formatD(now);
                    await fetchManualQuery(`from=${formatDateTime(past)}&to=${formatDateTime(now)}`);
                });
            };

            const setupDateShortcutButton = (buttonId, days) => {
                const button = document.getElementById(buttonId);
                if (!button) return;
                button.addEventListener("click", () => {
                    const today = new Date();
                    const past = new Date(); past.setDate(today.getDate() - days);
                    const fromEl = document.getElementById("slb-date-from");
                    const toEl = document.getElementById("slb-date-to");
                    if(fromEl) fromEl.value = formatD(past);
                    if(toEl) toEl.value = formatD(today);
                    document.getElementById("slb-date-search").click();
                });
            };
            setupHourShortcutButton("slb-date-1h", 1, true);
            setupHourShortcutButton("slb-date-3h", 3, true);
            setupHourShortcutButton("slb-date-6h", 6, true);
            setupHourShortcutButton("slb-date-12h", 12, true);
            setupHourShortcutButton("slb-date-24h", 24);
            setupDateShortcutButton("slb-date-7d", 7);
            setupDateShortcutButton("slb-date-30d", 30);
        } else {
            applyTheme(getPreferredTheme());
            overlay.style.display = "flex";
            ensureLicenseStateLoaded().then(() => updateProUi());
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
      const statusEl = document.getElementById("slb-header-status-text");
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
      const el = document.getElementById("slb-header-status-text");
      const lel = document.getElementById("slb-loading-text");
      if (el) el.innerHTML = text;
      if (lel) lel.innerHTML = text;
  }

  function updateProgress(text) {
      updateProgressStage(text);
      updateProgressLoaded("");
  }

  function updateProgressStage(text) {
      const el = document.getElementById("slb-header-progress-stage");
      if (el) el.textContent = text || "";
      syncProgressVisibility();
  }

  function updateProgressLoaded(text) {
      const el = document.getElementById("slb-header-progress-loaded");
      if (el) el.textContent = text || "";
      syncProgressVisibility();
  }

  function syncProgressVisibility() {
      const container = document.getElementById("slb-header-progress-text");
      if (!container) return;
      const stageText = document.getElementById("slb-header-progress-stage")?.textContent || "";
      const loadedText = document.getElementById("slb-header-progress-loaded")?.textContent || "";
      container.classList.toggle("is-visible", Boolean(stageText || loadedText));
  }

  function setProPromptStatus(message, type = "") {
      const statusEl = document.getElementById("slb-pro-status");
      if (!statusEl) return;
      statusEl.textContent = message || "";
      statusEl.classList.toggle("success", type === "success");
      statusEl.classList.toggle("error", type === "error");
  }

  function getLineLogoUrl() {
      try {
          if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
              return chrome.runtime.getURL(LINE_LOGO_RESOURCE);
          }
      } catch (e) {}
      return LINE_LOGO_RESOURCE;
  }

  function flashProCopyButton(button) {
      if (!button) return;
      const originalText = button.dataset.originalText || button.textContent || "複製裝置碼";
      button.dataset.originalText = originalText;
      button.textContent = "已複製";
      button.classList.add("copied");
      window.setTimeout(() => {
          button.textContent = button.dataset.originalText || "複製裝置碼";
          button.classList.remove("copied");
      }, 1200);
  }

  function updateProUi() {
      const statusEl = document.getElementById("slb-license-status");
      const pro = isProUnlocked();
      if (statusEl) {
          statusEl.textContent = pro ? "Pro" : "FREE";
          statusEl.classList.toggle("pro", pro);
      }

      const deviceEl = document.getElementById("slb-pro-device-id");
      if (deviceEl && licenseDeviceId) deviceEl.value = licenseDeviceId;

      const activatedEl = document.getElementById("slb-pro-activated-note");
      if (activatedEl) {
          if (pro) {
              activatedEl.textContent = `Pro 已啟用。授權：${licensePayload?.licenseId || "未命名"}`;
          } else {
              activatedEl.innerHTML = "目前為免費版。啟用 Pro 後可查詢最近二年，並使用 1/3/6/12 小時快捷查詢。<br>欲購買Pro版本請加入line好友並附上裝置碼";
          }
      }
  }

  function showProPrompt(reason = "此功能需要 Pro。") {
      onReady(async () => {
          ensureStyles();
          await ensureLicenseStateLoaded();
          const lineLogoUrl = getLineLogoUrl();

          let promptEl = document.getElementById("slb-pro-prompt");
          if (!promptEl) {
              promptEl = document.createElement("div");
              promptEl.id = "slb-pro-prompt";
              promptEl.dataset.theme = getPreferredTheme();
              promptEl.innerHTML = `
                  <div class="slb-pro-dialog" role="dialog" aria-modal="true" aria-labelledby="slb-pro-title">
                      <button type="button" class="slb-pro-close" id="slb-close-pro-prompt" aria-label="關閉 Pro 提示">X</button>
                      <h3 class="slb-pro-title" id="slb-pro-title">升級 Pro</h3>
                      <p class="slb-pro-copy" id="slb-pro-reason"></p>
                      <div class="slb-line-actions">
                          <a class="slb-line-logo-link" href="${LINE_PURCHASE_URL}" target="_blank" rel="noopener noreferrer" aria-label="加入 LINE 好友">
                              <img class="slb-line-logo" src="${lineLogoUrl}" alt="LINE">
                          </a>
                          <a class="slb-pro-link" href="${LINE_PURCHASE_URL}" target="_blank" rel="noopener noreferrer">加入 LINE 好友</a>
                      </div>
                      <p class="slb-pro-copy" id="slb-pro-activated-note"></p>
                      <div class="slb-pro-field-row" style="margin-bottom:12px;">
                          <input class="slb-pro-device" id="slb-pro-device-id" type="text" readonly value="">
                          <button type="button" class="slb-pro-button secondary" id="slb-copy-device-id">複製裝置碼</button>
                      </div>
                      <textarea class="slb-pro-license-input" id="slb-license-code-input" placeholder="貼上啟動序號，例如 SLB1.xxx.yyy"></textarea>
                      <div class="slb-pro-actions" style="margin-top:10px;">
                          <button type="button" class="slb-pro-button primary" id="slb-activate-license-btn">啟用 Pro</button>
                      </div>
                      <div class="slb-pro-status" id="slb-pro-status" aria-live="polite"></div>
                  </div>
              `;
              document.body.appendChild(promptEl);

              promptEl.addEventListener("click", (event) => {
                  if (event.target === promptEl) promptEl.remove();
              });

              document.getElementById("slb-close-pro-prompt")?.addEventListener("click", () => {
                  promptEl.remove();
              });

              document.getElementById("slb-copy-device-id")?.addEventListener("click", async () => {
                  const button = document.getElementById("slb-copy-device-id");
                  try {
                      await copyTextToClipboard(licenseDeviceId);
                      flashProCopyButton(button);
                  } catch (e) {
                      setProPromptStatus("複製失敗，請手動選取裝置碼。", "error");
                  }
              });

              document.getElementById("slb-activate-license-btn")?.addEventListener("click", async () => {
                  const inputEl = document.getElementById("slb-license-code-input");
                  const code = inputEl?.value || "";
                  try {
                      setProPromptStatus("正在驗證啟動碼...");
                      const payload = await activateLicenseCode(code);
                      setProPromptStatus(`啟用成功。授權：${payload.licenseId || "未命名"}`, "success");
                      if (inputEl) inputEl.value = "";
                      updateProUi();
                  } catch (e) {
                      setProPromptStatus(e?.message || "啟動碼驗證失敗。", "error");
                  }
              });
          } else {
              promptEl.style.display = "flex";
              promptEl.dataset.theme = getPreferredTheme();
          }

          const reasonEl = document.getElementById("slb-pro-reason");
          if (reasonEl) reasonEl.textContent = reason;
          updateProUi();
          if (isProUnlocked()) setProPromptStatus("Pro 已啟用，可直接使用進階查詢。", "success");
          else setProPromptStatus("請先複製裝置碼並透過 Line 取得啟動碼。");
      });
  }

  async function copyTextToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "-1000px";
      textarea.style.left = "-1000px";
      document.body.appendChild(textarea);
      textarea.select();

      try {
          if (!document.execCommand("copy")) {
              throw new Error("Copy command failed");
          }
      } finally {
          document.body.removeChild(textarea);
      }
  }

  function flashCopiedState(button) {
      button.classList.add("copied");
      button.title = "已複製";
      button.setAttribute("aria-label", "已複製整行");

      window.setTimeout(() => {
          button.classList.remove("copied");
          button.title = "複製整行";
          button.setAttribute("aria-label", "複製整行");
      }, 900);
  }

  function exportCSV() {
      if (!window.currentSLBBets || window.currentSLBBets.length === 0) {
          alert("目前沒有資料可匯出！");
          return;
      }
      
      let csvContent = "\uFEFF"; // BOM for UTF-8 Excel compatibility
      csvContent += "投注代碼,投注 ID,下注時間,玩法,投注內容,投注額,賠率,實際派彩/淨損益,狀態\n";
      
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
          
          let legTexts = b.legs ? b.legs.map(leg => {
              const legOdds = getLegOddsValue(leg);
              const oddsText = legOdds === null ? "" : ` @ ${formatOdds(legOdds)}`;
              const resultText = leg.eventResult ? ` 賽果 ${leg.eventResult}` : "";
              return `[${leg.eventName}] ${leg.marketName} - ${leg.selectionName}${oddsText}${resultText}`;
          }) : [];
          let contentText = legTexts.join(" | ");
          contentText = '"' + contentText.replace(/"/g, '""') + '"'; // Escape quotes for CSV
          
          let stateText = b.betState;
          let displayReturn = b.totalReturn || 0;
          const displayOdds = getBetOddsDisplay(b);
          if (["Settled", "CashedOut", "Closed", "Won", "Lost"].includes(b.betState)) {
               stateText = displayReturn > 0 ? "贏" : "輸";
          } else if (b.betState === "Void" || b.betState === "Cancelled") {
               stateText = "退回";
          } else {
               stateText = "未派彩";
          }
          
          csvContent += `"${b.ticketId || ''}","${b.id || ''}",${createdDate},${getBetTypeDisplay(b)},${contentText},${b.totalStake},${displayOdds},"${getReturnProfitText(b)}",${stateText}\n`;
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
      updatePayoutFilterControls();
      updateParlayCountFilterControls();

      window.slbSortCol = window.slbSortCol || 'date';
      if (window.slbSortDesc === undefined) window.slbSortDesc = true;

      const filteredBets = [...betsArray].filter((bet) => betMatchesSportFilter(bet) && betMatchesPayoutFilter(bet) && betMatchesParlayCountFilter(bet));
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
          } else if (window.slbSortCol === 'odds') {
              valA = getBetOddsValue(a) || 0;
              valB = getBetOddsValue(b) || 0;
          } else if (window.slbSortCol === 'return') {
              valA = isSettledBet(a) ? (a.totalReturn || 0) : 0;
              valB = isSettledBet(b) ? (b.totalReturn || 0) : 0;
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
                      <th data-sort="odds" style="cursor:pointer; user-select:none;" title="點擊排序">賠率 ${getSortIcon('odds')}</th>
                      <th data-sort="return" style="cursor:pointer; user-select:none;" title="點擊排序">實際派彩/淨損益 ${getSortIcon('return')}</th>
                      <th data-sort="state" style="cursor:pointer; user-select:none;" title="點擊排序">狀態 ${getSortIcon('state')}</th>
                      <th class="slb-copy-head" aria-label="複製"></th>
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
          const displayOdds = getBetOddsDisplay(b);

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
          let rowContentText = "";
          
          const metaHtml = `<div class="slb-content-meta" style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; user-select:text; cursor:auto;" onclick="event.stopPropagation();">
              <div><b class="slb-meta-label">投注代碼：</b> ${escapeHTML(b.ticketId || b.id || '無')}</div>
              <div><b class="slb-meta-label">投注 ID：</b> ${escapeHTML(b.id || '無')}</div>
          </div>`;

          if (b.legs && b.legs.length > 0) {
              const rawLegTexts = b.legs.map(leg => {
                  const ev = leg.eventName || '未知';
                  const mk = leg.marketName || '';
                  const sel = leg.selectionName || '';
                  const legOdds = getLegOddsValue(leg);
                  const oddsText = legOdds === null ? "" : ` @ ${formatOdds(legOdds)}`;
                  const resultText = leg.eventResult ? ` 賽果 ${leg.eventResult}` : "";
                  return `[${ev}] ${mk} - ${sel}${oddsText}${resultText}`;
              });
              const htmlLegTexts = b.legs.map(leg => {
                  const ev = escapeHTML(leg.eventName || '未知');
                  const mk = escapeHTML(leg.marketName || '');
                  const sel = escapeHTML(leg.selectionName || '');
                  const legOdds = getLegOddsValue(leg);
                  const oddsHtml = legOdds === null ? "" : ` <span class="slb-leg-odds">賠率 ${formatOdds(legOdds)}</span>`;
                  const legStatus = getLegStatusMeta(leg);
                  const statusIconHtml = legStatus.text ? `<span class="slb-leg-status-icon ${legStatus.className}" title="${escapeHTML(legStatus.text)}" aria-label="${escapeHTML(legStatus.text)}"></span>` : "";
                  const resultHtml = leg.eventResult ? ` <span class="slb-leg-result">賽果 ${escapeHTML(leg.eventResult)}</span>` : "";
                  return `<div class="slb-content-leg">${statusIconHtml}<span class="slb-leg-line">[${ev}] ${mk} - <b>${sel}</b>${oddsHtml}${resultHtml}</span></div>`;
              });
              contentText = metaHtml + htmlLegTexts.join("");
              fullContentText = rawLegTexts.map(escapeHTML).join("\n");
              rowContentText = rawLegTexts.join(" | ");
          } else {
              contentText = metaHtml + "<div class='slb-content-leg'>無法讀取詳細資訊</div>";
              fullContentText = "無法讀取詳細資訊";
              rowContentText = "無法讀取詳細資訊";
          }

          const rowCopyText = [
              createdDate,
              getBetTypeDisplay(b),
              rowContentText,
              `NT$ ${b.totalStake || 0}`,
              displayOdds,
              getReturnProfitText(b),
              badgeText
          ].join("\t");

          const returnProfitText = getReturnProfitText(b);
          const profitLossClass = getProfitLossClass(b);

          tableHtml += `
              <tr class="slb-row" style="cursor:pointer; transition: background 0.2s;" onclick="const c = this.querySelector('.slb-content'); if(c) c.classList.toggle('expanded');">
                  <td class="slb-date">${createdDate}</td>
                  <td class="slb-type">${escapeHTML(getBetTypeDisplay(b))}</td>
                  <td class="slb-content" title="${fullContentText}" onclick="event.stopPropagation(); this.classList.toggle('expanded');">${contentText}</td>
                  <td class="slb-amount">NT$ ${b.totalStake}</td>
                  <td class="slb-amount">${displayOdds}</td>
                  <td class="slb-amount ${isWin ? 'win' : ''}" title="${escapeHTML(returnProfitText)}">
                      <span class="slb-return-profit">
                          <span>${getActualReturnDisplay(b)}</span>
                          <span class="slb-return-profit-separator">/</span>
                          <span class="${profitLossClass}">${getNetProfitLossDisplay(b)}</span>
                      </span>
                  </td>
                  <td>
                      <span class="slb-badge ${badgeClass}">${badgeText}</span>
                  </td>
                  <td class="slb-copy-cell">
                      <button type="button" class="slb-copy-row-btn" title="複製整行" aria-label="複製整行" data-copy-text="${escapeHTML(rowCopyText)}">
                          <svg class="slb-copy-icon" viewBox="0 0 24 24" aria-hidden="true">
                              <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                      </button>
                  </td>
              </tr>
          `;
      });
      
      tableHtml += `</tbody></table>`;
      container.innerHTML = tableHtml;

      const summaryEl = document.getElementById("slb-status-text");
      if (summaryEl) {
          const pl = settledReturn - settledBet;
          summaryEl.innerHTML = `
            <div class="slb-summary-row">
                <span class="slb-summary-chip">
                    💰 <b>本金去向</b>：總投入 <b>NT$ ${totalBet}</b> = 未派彩 <span class="slb-summary-warning">NT$ ${pendingStake}</span> + 已結算本金 <b>NT$ ${settledBet}</b>
                </span>
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

      container.querySelectorAll(".slb-copy-row-btn").forEach(button => {
          button.addEventListener("click", async (event) => {
              event.preventDefault();
              event.stopPropagation();

              try {
                  await copyTextToClipboard(button.dataset.copyText || "");
                  flashCopiedState(button);
              } catch (err) {
                  console.warn("Failed to copy row", err);
                  alert("複製失敗，請再試一次。");
              }
          });
      });
  }

  // NATIVE FETCH INSIDE IFRAME (Same-Origin, NO CORS ERRORS!)
  async function fetchAllDataNatively(baseUrl, headers, queryStr, fetchOptions = {}) {
      const { fetchRunId = "", signal = null } = fetchOptions;
      let finalBaseUrl = baseUrl;
      if (!finalBaseUrl.startsWith("http")) {
           finalBaseUrl = "https://www-talo-ssb-pr.sportslottery.com.tw" + (finalBaseUrl.startsWith('/') ? '' : '/') + finalBaseUrl;
      }

      const localDatabase = new Map();

      const formatLocal = (d) => {
          const pad = n => n.toString().padStart(2, '0');
          return d.getFullYear() + '-' +
                 pad(d.getMonth() + 1) + '-' +
                 pad(d.getDate()) + 'T' +
                 pad(d.getHours()) + ':' +
                 pad(d.getMinutes()) + ':' +
                 pad(d.getSeconds()) + '.' +
                 d.getMilliseconds().toString().padStart(3, '0');
      };

      const parseApiDate = (value) => {
          const parsed = new Date(value);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
      };

      const formatDateOnly = (d) => formatLocal(d).split("T")[0];

      const buildDateChunks = (start, end) => {
          const chunks = [];
          const maxRangeMs = 30 * 24 * 60 * 60 * 1000;
          let cursor = new Date(end);

          while (cursor >= start) {
              const chunkStart = new Date(Math.max(cursor.getTime() - maxRangeMs + 1, start.getTime()));
              chunks.push({
                  from: formatLocal(chunkStart),
                  to: formatLocal(cursor),
                  fromDate: formatDateOnly(chunkStart),
                  toDate: formatDateOnly(cursor)
              });
              cursor = new Date(chunkStart.getTime() - 1);
          }

          return chunks;
      };

      const throwIfCancelled = () => {
          if (signal?.aborted || (fetchRunId && fetchRunId !== activeFetchRunId)) {
              throw new Error("SLB_FETCH_CANCELLED");
          }
      };

      const getDateChunkFetchDelayMs = () => {
          const min = DATE_CHUNK_FETCH_DELAY_MIN_MS;
          const max = DATE_CHUNK_FETCH_DELAY_MAX_MS;
          return min + Math.floor(Math.random() * (max - min + 1));
      };

      const sleep = (ms) => new Promise((resolve, reject) => {
          if (signal?.aborted) {
              reject(new Error("SLB_FETCH_CANCELLED"));
              return;
          }
          const timer = setTimeout(resolve, ms);
          signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("SLB_FETCH_CANCELLED"));
          }, { once: true });
      });

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
          fromStr = formatLocal(past30);
          toStr = formatLocal(today);
      }

      const requestedFromStr = fromStr;
      const requestedToStr = toStr;
      const requestedFromDate = parseApiDate(requestedFromStr);
      const requestedToDate = parseApiDate(requestedToStr);
      const dateChunks = requestedFromDate && requestedToDate && requestedFromDate <= requestedToDate
          ? buildDateChunks(requestedFromDate, requestedToDate)
          : [{
              from: requestedFromStr,
              to: requestedToStr,
              fromDate: requestedFromStr.split("T")[0],
              toDate: requestedToStr.split("T")[0]
          }];

      async function fetchState(betState, rangeFromStr, rangeToStr) {
          let pageNum = 0;
          let hasMore = true;

          while (hasMore && pageNum < 50) {
              throwIfCancelled();
              const params = new URLSearchParams({
                  from: rangeFromStr,
                  to: rangeToStr,
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

              const targetUrl = finalBaseUrl + "?" + params.toString();

              try {
                  const resp = await window.fetch(targetUrl, {
                      method: "GET",
                      headers: headers,
                      signal
                  });

                  if (!resp.ok) {
                      throw new Error(`HTTP ${resp.status} - ${await resp.text()}`);
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
                              const totalMultiBetOdds = Number(item.totalMultiBetOdds);
                              const legOdds = getItemOddsValue(item);
                              if (!localDatabase.has(betId)) {
                                  localDatabase.set(betId, {
                                      id: item.idFOBet || item.id || betId,
                                      fullExternalReference: betId,
                                      createdDate: item.tsAttempted,
                                      betTypeName: item.betTypeName,
                                      betState: item.betState,
                                      totalStake: item.totalStake || item.wunitStake || 0,
                                      odds: Number.isFinite(totalMultiBetOdds) && totalMultiBetOdds > 0 ? totalMultiBetOdds : null,
                                      totalReturn: item.betState === 'Open' ? item.potentialReturn : (item.totalReturn || item.discountedTotalReturn || 0),
                                      ticketId: item.idFOBetslip || item.receipt || item.ticketId || item.externalRef || item.shortId || '',
                                      legs: []
                                  });
                              }
                              const savedBet = localDatabase.get(betId);
                              if (!savedBet.odds && Number.isFinite(totalMultiBetOdds) && totalMultiBetOdds > 0) {
                                  savedBet.odds = totalMultiBetOdds;
                              }
                              savedBet.legs.push({
                                  idFOSportType: item.idFOSportType,
                                  idFOSport: item.idFOSport,
                                  tournamentName: item.tournamentName,
                                  eventName: item.eventName,
                                  eventResult: item.eventResult,
                                  marketName: item.marketName,
                                  selectionName: item.selectionName,
                                  betLegStatus: item.betLegStatus,
                                  betResult: item.betResult,
                                  winWLDOutcome: item.winWLDOutcome,
                                  outcome: item.outcome,
                                  odds: legOdds,
                                  ownPriceUp: item.ownPriceUp,
                                  ownPriceDown: item.ownPriceDown,
                                  wunitStake: item.wunitStake,
                                  legOrder: item.legOrder
                              });
                          }
                      });
                      if (data.length < 50) hasMore = false;
                      else pageNum++;
                  } else {
                      hasMore = false;
                  }
              } catch (e) {
                  if (isFetchCancelledError(e) || signal?.aborted) throw new Error("SLB_FETCH_CANCELLED");
                  throw new Error(`Fetch failed: ${e.message}`);
              }
          }
      }

      for (let index = 0; index < dateChunks.length; index++) {
          throwIfCancelled();
          const chunk = dateChunks[index];
          if (window.parent) {
              window.parent.postMessage({
                  type: 'SLB_FETCH_PROGRESS',
                  fetchRunId,
                  current: index + 1,
                  total: dateChunks.length,
                  fromDate: chunk.fromDate,
                  toDate: chunk.toDate
              }, '*');
          }
          await fetchState("Opened", chunk.from, chunk.to);
          await fetchState("Settled", chunk.from, chunk.to);
          throwIfCancelled();
          if (window.parent) {
              window.parent.postMessage({
                  type: 'SLB_DATA_FETCHED',
                  fetchRunId,
                  partial: true,
                  current: index + 1,
                  total: dateChunks.length,
                  loadedCount: localDatabase.size,
                  bets: Array.from(localDatabase.values()),
                  fromStr: requestedFromStr,
                  toStr: requestedToStr
              }, '*');
          }
          if (index < dateChunks.length - 1) {
              throwIfCancelled();
              await sleep(getDateChunkFetchDelayMs());
          }
      }

      return {
          bets: localDatabase,
          fromStr: requestedFromStr,
          toStr: requestedToStr
      };
  }
})();
