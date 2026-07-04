const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "sportslottery-my-bets.user.js"), "utf8");
const manifestSource = readFileSync(join(__dirname, "..", "manifest.json"), "utf8");
const manifest = JSON.parse(manifestSource);
const backgroundSource = readFileSync(join(__dirname, "..", "background.js"), "utf8");
const parlayFixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "parlay-filter-sample.json"), "utf8"));

function cssBlock(selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "m"));
    assert.ok(match, `Missing CSS block for ${selector}`);
    return match[1];
}

function buttonById(id) {
    const match = source.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`));
    assert.ok(match, `Missing button #${id}`);
    return match[0];
}

function functionBlock(name) {
    const start = source.indexOf(`function ${name}`);
    assert.ok(start >= 0, `Missing function ${name}`);
    const next = source.indexOf("\n  function ", start + name.length);
    return source.slice(start, next === -1 ? source.length : next);
}

function constantObjectBlock(name) {
    const match = source.match(new RegExp(`const ${name} = \\{[\\s\\S]*?\\n  \\};`));
    assert.ok(match, `Missing constant ${name}`);
    return match[0];
}

function parlayHelpers() {
    return vm.runInNewContext([
        constantObjectBlock("BET_TYPE_PARLAY_COUNTS"),
        constantObjectBlock("BET_TYPE_DISPLAY_LABELS"),
        constantObjectBlock("PARLAY_COUNT_LABELS"),
        functionBlock("parseChineseParlayCount"),
        functionBlock("getParlayCountFromTypeName"),
        functionBlock("isAccumulatorBetType"),
        functionBlock("getBetParlayCount"),
        functionBlock("formatParlayCountLabel"),
        functionBlock("getBetTypeNameDisplay"),
        functionBlock("getAvailableParlayCounts"),
        functionBlock("hasAccumulatorBets"),
        "({ getBetParlayCount, getAvailableParlayCounts, getBetTypeNameDisplay, hasAccumulatorBets, isAccumulatorBetType })",
    ].join("\n"));
}

function groupFixtureBets(rows) {
    const grouped = new Map();
    for (const row of rows) {
        if (!grouped.has(row.fullExternalReference)) {
            grouped.set(row.fullExternalReference, {
                fullExternalReference: row.fullExternalReference,
                betTypeName: row.betTypeName,
                legs: [],
            });
        }
        grouped.get(row.fullExternalReference).legs.push({ legOrder: row.legOrder });
    }
    return [...grouped.values()];
}

test("uses actual payout / net profit-loss label", () => {
    assert.match(source, /實際派彩\/淨損益/);
    assert.doesNotMatch(source, /預計\/實際派彩/);
});

test("bet rows can still expand and collapse", () => {
    assert.match(
        source,
        /<tr class="slb-row"[^`]*onclick="[^"]*querySelector\('\.slb-content'\)[^"]*classList\.toggle\('expanded'\)/s
    );
    assert.match(
        source,
        /<td class="slb-content"[^`]*onclick="event\.stopPropagation\(\); this\.classList\.toggle\('expanded'\);"/s
    );
    assert.match(cssBlock(".slb-table td.slb-content"), /text-align:\s*left;/);
    assert.match(cssBlock(".slb-content.expanded"), /white-space:\s*normal;/);
    assert.match(cssBlock(".slb-content.expanded"), /max-width:\s*400px;/);
    assert.match(cssBlock(".slb-content.expanded div.slb-content-leg"), /display:\s*flex;/);
});

test("return and profit-loss display stays on one line", () => {
    const block = cssBlock(".slb-return-profit");
    assert.match(block, /display:\s*inline-flex;/);
    assert.match(block, /white-space:\s*nowrap;/);
    assert.doesNotMatch(block, /flex-direction:\s*column/);
    assert.doesNotMatch(source, /<td class="slb-amount slb-return-profit/);
    assert.match(
        source,
        /<span class="slb-return-profit">[\s\S]*getActualReturnDisplay\(b\)[\s\S]*slb-return-profit-separator[\s\S]*getNetProfitLossDisplay\(b\)/
    );
});

test("date shortcut buttons include hour and day ranges", () => {
    const proButtons = [
        ["slb-date-1h", "1小時", 1],
        ["slb-date-3h", "3小時", 3],
        ["slb-date-6h", "6小時", 6],
        ["slb-date-12h", "12小時", 12],
    ];
    for (const [id, label, hours] of proButtons) {
        const button = buttonById(id);
        assert.match(button, /slb-date-shortcut-pro/);
        assert.match(button, new RegExp(`>${label}<span class="slb-pro-flag">PRO</span></button>`));
        assert.match(source, new RegExp(`setupHourShortcutButton\\("${id}",\\s*${hours},\\s*true\\);`));
    }

    assert.match(buttonById("slb-date-24h"), />24小時<\/button>/);
    assert.match(buttonById("slb-date-7d"), />7天<\/button>/);
    assert.match(buttonById("slb-date-30d"), />30天<\/button>/);
    assert.doesNotMatch(buttonById("slb-date-24h"), /slb-pro-flag/);
    assert.doesNotMatch(buttonById("slb-date-7d"), /slb-pro-flag/);
    assert.doesNotMatch(buttonById("slb-date-30d"), /slb-pro-flag/);
    assert.match(source, /setupHourShortcutButton\("slb-date-24h",\s*24\);/);
    assert.match(source, /setupDateShortcutButton\("slb-date-7d",\s*7\);/);
    assert.match(source, /setupDateShortcutButton\("slb-date-30d",\s*30\);/);
});

test("loading status appears after the collapse toggle in the header", () => {
    const toggleIndex = source.indexOf('id="slb-report-toggle"');
    const statusIndex = source.indexOf('id="slb-header-status-text"');
    const progressIndex = source.indexOf('id="slb-header-progress-text"');
    const panelIndex = source.indexOf('id="slb-report-panel"');
    const summaryIndex = source.indexOf('id="slb-status-text"');

    assert.ok(toggleIndex > 0, "missing collapse toggle");
    assert.ok(statusIndex > toggleIndex, "status text should be after collapse toggle");
    assert.ok(progressIndex > statusIndex, "progress text should be after status text");
    assert.ok(panelIndex > progressIndex, "status and progress should be before the report panel");
    assert.ok(summaryIndex > panelIndex, "summary status should stay inside the report panel");
    assert.match(source, /<div class="slb-header-status">[\s\S]*id="slb-header-status-text"[\s\S]*id="slb-header-progress-text"/);
    assert.match(source, /<div id="slb-report-panel" class="slb-report-panel">[\s\S]*id="slb-status-text"/);
    assert.match(source, /const summaryEl = document\.getElementById\("slb-status-text"\);[\s\S]*本金去向[\s\S]*結算戰績/);
    assert.match(source, /function updateStatus\(text\) \{[\s\S]*document\.getElementById\("slb-header-status-text"\)/);
    assert.doesNotMatch(source, /id="slb-header-status-text">正在載入資料/);
    assert.doesNotMatch(source, /updateStatus\("正在載入資料/);
    assert.doesNotMatch(source, /資料拉取完成！正在渲染報表/);
});

test("pro flag is compact and stays inside pro shortcut buttons", () => {
    assert.match(cssBlock(".slb-date-shortcut-pro"), /overflow:\s*hidden;/);
    const block = cssBlock(".slb-pro-flag");
    assert.match(block, /top:\s*0;/);
    assert.match(block, /right:\s*0;/);
    assert.match(block, /height:\s*6px;/);
    assert.match(block, /width:\s*18px;/);
    assert.match(block, /border-radius:\s*0 5px 0 3px;/);
    assert.doesNotMatch(cssBlock(".slb-date-shortcut-pro"), /padding-right/);
    assert.doesNotMatch(block, /top:\s*-\d/);
    assert.doesNotMatch(block, /right:\s*-\d/);
});

test("parlay count filter is shown as a pro filter", () => {
    assert.match(source, /window\.slbSelectedParlayCounts = window\.slbSelectedParlayCounts \|\| \[\];/);
    assert.match(source, /window\.slbSelectedParlayTypes = window\.slbSelectedParlayTypes \|\| \[\];/);
    assert.match(source, /<span class="slb-filter-inline-label">過關數：<\/span>/);
    assert.doesNotMatch(source, /過關數：<span class="slb-filter-pro-flag">PRO<\/span>/);
    assert.match(source, /id="slb-parlay-count-filter-options"/);
    assert.match(source, /data-parlay-count="ALL">全部<\/button>/);
    assert.match(source, /class="slb-sport-filter-btn slb-date-shortcut-pro \$\{activeTypeSelected\.has\("ACCUMULATOR"\) \? "active" : ""\}" data-parlay-type="ACCUMULATOR">全部過關<span class="slb-pro-flag">PRO<\/span><\/button>/);
    assert.match(source, /\$\{formatParlayCountLabel\(count\)\}<span class="slb-pro-flag">PRO<\/span><\/button>/);
    assert.doesNotMatch(source, /slb-filter-pro-flag/);
    assert.match(cssBlock(".slb-sport-filter-btn"), /position:\s*relative;/);
    assert.match(source, /updateParlayCountFilterControls\(\);[\s\S]*betMatchesParlayCountFilter\(bet\)/);
});

test("parlay count filter uses bet type name instead of leg count", () => {
    const block = functionBlock("getParlayCountFromTypeName");
    assert.match(block, /const typeName = String\(betTypeName \|\| ""\)\.trim\(\);/);
    assert.match(block, /const mappedCount = BET_TYPE_PARLAY_COUNTS\[typeName\.toLowerCase\(\)\];/);
    assert.match(block, /if \(mappedCount\) return mappedCount;/);
    assert.match(block, /typeName\.match\(\/\(\\d\+\)\\s\*關\//);
    assert.match(block, /typeName\.match\(\/\(\[一二兩三四五六七八九十\]\+\)\\s\*關\//);
    assert.match(block, /return chineseCount \|\| null;/);
    assert.doesNotMatch(block, /legs\.length/);
    assert.match(source, /function getBetParlayCount\(bet\) \{[\s\S]*return getParlayCountFromTypeName\(bet\?\.betTypeName\) \|\| 1;/);
    assert.match(source, /function isMultiSingleBet\(bet\) \{[\s\S]*getParlayCountFromTypeName\(bet\?\.betTypeName\) === 1/);
    assert.match(source, /function getBetTypeDisplay\(bet\) \{[\s\S]*const typeName = getBetTypeNameDisplay\(bet\?\.betTypeName\);/);
    assert.ok(source.includes('return PARLAY_COUNT_LABELS[count] || `${count}關`;'));
});

test("parlay labels use the official Chinese names", () => {
    const expected = [
        ["singles", 1, "一關"],
        ["double", 2, "兩關"],
        ["doubles", 2, "兩關"],
        ["treble", 3, "三關"],
        ["trebles", 3, "三關"],
        ['"4-folds"', 4, "四關"],
        ['"5-folds"', 5, "五關"],
        ['"6-folds"', 6, "六關"],
        ['"7-folds"', 7, "七關"],
        ['"8-folds"', 8, "八關"],
        ['"9-folds"', 9, "九關"],
        ['"10-folds"', 10, "十關"],
        ['"11-folds"', 11, "十一關"],
        ['"12-folds"', 12, "十二關"],
    ];

    for (const [key, count, label] of expected) {
        assert.match(source, new RegExp(`${key}:\\s*${count}`));
        assert.match(source, new RegExp(`${count}:\\s*"${label}"`));
    }
});

test("accumulator displays as all-pass and stays out of numeric parlay filters", () => {
    assert.match(source, /const BET_TYPE_DISPLAY_LABELS = \{[\s\S]*accumulator:\s*"全部過關"[\s\S]*"全部過關":\s*"全部過關"/);
    assert.match(source, /function isAccumulatorBetType\(betTypeName\) \{[\s\S]*typeName\.toLowerCase\(\) === "accumulator" \|\| typeName === "全部過關";/);
    assert.match(source, /function hasAccumulatorBets\(bets\) \{[\s\S]*isAccumulatorBetType\(bet\?\.betTypeName\)/);
    assert.match(
        source,
        /function getBetParlayCount\(bet\) \{[\s\S]*if \(isAccumulatorBetType\(bet\?\.betTypeName\)\) return null;[\s\S]*return getParlayCountFromTypeName\(bet\?\.betTypeName\) \|\| 1;/
    );
    assert.doesNotMatch(functionBlock("getBetParlayCount"), /legs\.length/);
    assert.match(
        source,
        /function getBetTypeNameDisplay\(betTypeName\) \{[\s\S]*BET_TYPE_DISPLAY_LABELS\[String\(betTypeName \|\| ""\)\.trim\(\)\.toLowerCase\(\)\][\s\S]*if \(mappedLabel\) return mappedLabel;/
    );
    assert.match(
        source,
        /if \(selectedTypes\.includes\("ACCUMULATOR"\)\) return isAccumulatorBetType\(bet\?\.betTypeName\);/
    );
    assert.match(
        source,
        /if \(isAccumulatorBetType\(bet\?\.betTypeName\)\) return false;/
    );
});

test("sample bet data keeps all-pass slips out of five/seven numeric filters", () => {
    const helpers = parlayHelpers();
    const bets = groupFixtureBets(parlayFixture);
    const allPassBets = bets.filter((bet) => helpers.isAccumulatorBetType(bet.betTypeName));

    assert.deepEqual(
        allPassBets.map((bet) => [bet.fullExternalReference, bet.legs.length, helpers.getBetParlayCount(bet)]),
        [
            ["724/919", 5, null],
            ["723/918", 7, null],
        ]
    );
    assert.deepEqual([...helpers.getAvailableParlayCounts(bets)], [1, 2, 3]);
    assert.equal(helpers.hasAccumulatorBets(bets), true);
    assert.equal(helpers.getBetTypeNameDisplay("全部過關"), "全部過關");
});

test("free users are gated from parlay count filtering", () => {
    const updateBlock = functionBlock("updateParlayCountFilterControls");
    const clickBlock = updateBlock.slice(updateBlock.indexOf('button.addEventListener("click"'));
    assert.match(
        clickBlock,
        /if \(parlayCount === "ALL"\) \{[\s\S]*window\.slbSelectedParlayCounts = \[\];[\s\S]*window\.slbSelectedParlayTypes = \[\];[\s\S]*return;[\s\S]*\}[\s\S]*if \(!await ensureLicenseStateLoaded\(\)\) \{[\s\S]*showProPrompt\("過關數篩選屬於 Pro 功能。"\);[\s\S]*return;[\s\S]*\}/
    );
    assert.match(
        clickBlock,
        /if \(parlayType === "ACCUMULATOR"\) \{[\s\S]*window\.slbSelectedParlayTypes = currentSelected\.includes\("ACCUMULATOR"\) \? \[\] : \["ACCUMULATOR"\];[\s\S]*window\.slbSelectedParlayCounts = \[\];/
    );

    const allIndex = clickBlock.indexOf('if (parlayCount === "ALL")');
    const gateIndex = clickBlock.indexOf("if (!await ensureLicenseStateLoaded())");
    const promptIndex = clickBlock.indexOf('showProPrompt("過關數篩選屬於 Pro 功能。")');
    const nonAllStateUpdateIndex = clickBlock.indexOf("window.slbSelectedParlayCounts = currentSelected", gateIndex);
    assert.ok(allIndex >= 0, "ALL should be handled separately");
    assert.ok(gateIndex >= 0, "missing pro prompt gate");
    assert.ok(gateIndex > allIndex, "ALL should not require pro access");
    assert.ok(promptIndex > gateIndex, "free users should see a pro prompt for specific counts");
    assert.ok(nonAllStateUpdateIndex > promptIndex, "specific count state should update only after pro access passes");
});

test("manifest and background expose the Google account identity bridge", () => {
    assert.ok(manifest.permissions.includes("identity"));
    assert.ok(manifest.permissions.includes("identity.email"));
    assert.equal(manifest.background.service_worker, "background.js");
    assert.match(backgroundSource, /SLB_GET_PROFILE_USER_INFO/);
    assert.match(backgroundSource, /chrome\.identity\.getProfileUserInfo\(\{ accountStatus: "ANY" \}/);
    assert.match(backgroundSource, /const accountId = String\(profileInfo\?\.id \|\| ""\)\.trim\(\);/);
    assert.match(backgroundSource, /sendResponse\(\{ ok: true, accountId, email \}\);/);
    assert.match(backgroundSource, /請先登入 Chrome/);
    assert.doesNotMatch(source, /chrome\.identity/);
});

test("pro license state uses a Google-account-bound SLB2 signed activation code", () => {
    assert.match(source, /const LINE_PURCHASE_URL = "https:\/\/lin\.ee\/zsGJ9oT";/);
    assert.match(source, /const LICENSE_CODE_KEY = "slb_license_code";/);
    assert.match(source, /const LICENSE_PAYLOAD_KEY = "slb_license_payload";/);
    assert.match(source, /const LICENSE_CODE_PREFIX = "SLB2";/);
    assert.match(source, /const LICENSE_AUTH_REQUEST_PREFIX = "SLBAUTH2";/);
    assert.match(source, /const LICENSE_AUTH_APP = "sportslottery_bet";/);
    assert.match(source, /const LICENSE_AUTH_VERSION = 2;/);
    assert.match(source, /const LICENSE_CHROME_LOGIN_MESSAGE = "請先登入 Chrome";/);
    assert.match(source, /const LICENSE_SYNCING_MESSAGE = "正在同步授權\.\.\.";/);
    assert.match(source, /const LICENSE_SYNC_FAILED_MESSAGE = "Chrome 同步失敗，如果遺失啟動序號請洽 Line。";/);
    assert.match(source, /const LICENSE_PUBLIC_JWK = \{[\s\S]*crv: "P-256"[\s\S]*x: "oQxSKeY749vnhbNsCcb_Wz-STUATErKDJBXsaouM1ww"[\s\S]*y: "lty1AQ4XHSGcEF3eE3Oov8t35wXGXs1Kb7rP6kiDltE"/);
    assert.match(source, /function getLicenseSigningBytes\(payloadPart\) \{[\s\S]*`\$\{LICENSE_CODE_PREFIX\}\.\$\{payloadPart\}`/);
    const encodeBlock = functionBlock("textToBase64Url");
    assert.match(encodeBlock, /new TextEncoder\(\)\.encode\(value\)/);
    assert.match(encodeBlock, /btoa\(binary\)/);
    assert.match(encodeBlock, /replace\(\/\\\+\/g, "-"\)/);
    assert.match(encodeBlock, /replace\(\/\\\/\/g, "_"\)/);
    assert.match(encodeBlock, /replace\(\/=\+\$\/g, ""\)/);
    assert.match(source, /async function verifyLicenseCode\(code, accountId\)/);
    assert.match(source, /chrome\.runtime\.sendMessage\(\{ type: "SLB_GET_PROFILE_USER_INFO" \}/);
    assert.match(source, /accountId:\s*licenseAccountInfo\.accountId/);
    assert.match(source, /email:\s*licenseAccountInfo\.email \|\| ""/);
    assert.match(source, /app:\s*LICENSE_AUTH_APP/);
    assert.match(source, /licenseVersion:\s*LICENSE_AUTH_VERSION/);
    assert.match(source, /payload\.version !== LICENSE_AUTH_VERSION \|\| payload\.plan !== "pro"/);
    assert.match(source, /payload\.accountId !== accountId/);
    assert.match(source, /crypto\.subtle\.importKey\([\s\S]*"ECDSA"[\s\S]*namedCurve: "P-256"/);
    assert.match(source, /crypto\.subtle\.verify\([\s\S]*hash: "SHA-256"[\s\S]*getLicenseSigningBytes\(parts\[1\]\)/);
    assert.match(source, /function getExtensionStorage\(area = "local"\)/);
    assert.match(source, /function getStoredLicenseState\(\) \{[\s\S]*storageGetFrom\("local", keys\)[\s\S]*return storageGetFrom\("sync", keys\);/);
    assert.match(source, /function persistLicenseState\(values\) \{[\s\S]*licenseSyncStatus = LICENSE_SYNCING_MESSAGE;[\s\S]*storageSetTo\("local", values\)[\s\S]*storageSetTo\("sync", values\)[\s\S]*licenseSyncStatus = syncOk \? "" : LICENSE_SYNC_FAILED_MESSAGE;/);
    assert.match(source, /function removeStoredLicenseState\(keys\) \{[\s\S]*storageRemoveFrom\("local", keys\)[\s\S]*storageRemoveFrom\("sync", keys\)[\s\S]*licenseSyncStatus = syncOk \? "" : LICENSE_SYNC_FAILED_MESSAGE;/);
    assert.match(source, /if \(!storage\) return Promise\.resolve\(\{ ok: area !== "sync", error: "storage unavailable" \}\);/);
    assert.match(source, /await persistLicenseState\(\{[\s\S]*\[LICENSE_CODE_KEY\]: String\(code \|\| ""\)\.trim\(\),[\s\S]*\[LICENSE_PAYLOAD_KEY\]: payload/);
    assert.match(source, /const result = await getStoredLicenseState\(\);/);
    assert.match(source, /await persistLicenseState\(\{[\s\S]*\[LICENSE_CODE_KEY\]: savedCode,[\s\S]*\[LICENSE_PAYLOAD_KEY\]: licensePayload/);
    assert.match(source, /return licensePayload\?\.plan === "pro" && licensePayload\?\.accountId === licenseAccountInfo\?\.accountId;/);
    assert.doesNotMatch(source, /LICENSE_DEVICE_ID_KEY/);
    assert.doesNotMatch(source, /slb_device_id/);
    assert.doesNotMatch(source, /payload\.deviceId/);
    assert.doesNotMatch(source, /licenseDeviceId/);
    assert.doesNotMatch(source, /generateDeviceId/);
    assert.doesNotMatch(source, /SLB1/);
    assert.match(source, /statusEl\.textContent = pro \? "Pro" : "FREE";/);
    assert.doesNotMatch(source, /statusEl\.textContent = pro \? "PRO 已啟用" : "FREE";/);

    const verifyIndex = source.indexOf("const signatureOk = await crypto.subtle.verify");
    const parseIndex = source.indexOf("payload = JSON.parse", verifyIndex);
    assert.ok(verifyIndex > 0, "missing signature verification");
    assert.ok(parseIndex > verifyIndex, "payload should be parsed only after signature verification");
});

test("free users are gated from pro shortcuts before manual fetch is posted", () => {
    assert.match(
        source,
        /if \(requiresPro && !await ensureLicenseStateLoaded\(\)\) \{[\s\S]*showProPrompt\(`\$\{hours\}小時快捷查詢屬於 Pro 功能。`\);[\s\S]*return;[\s\S]*\}[\s\S]*await fetchManualQuery/
    );
    assert.match(
        source,
        /const access = await getDateRangeAccess\(queryStr\);[\s\S]*if \(!access\.allowed\) \{[\s\S]*if \(access\.type === "pro"\) showProPrompt\(access\.message\);[\s\S]*else setDateLimitError\(access\.message\);[\s\S]*return;[\s\S]*\}[\s\S]*type: 'SLB_FETCH_MANUAL'/
    );
});

test("date range access enforces one-year free and two-year pro limits", () => {
    assert.match(source, /const FREE_MAX_LOOKBACK_DAYS = 365;/);
    assert.match(source, /const PRO_MAX_LOOKBACK_DAYS = 730;/);
    assert.match(source, /async function getDateRangeAccess\(queryStr\)/);
    assert.match(source, /const pro = isProUnlocked\(\);/);
    assert.match(source, /const freeOldest = getOldestAllowedDate\(FREE_MAX_LOOKBACK_DAYS\);/);
    assert.match(source, /fromDay < freeOldest \|\| rangeDays > FREE_MAX_LOOKBACK_DAYS/);
    assert.match(source, /查詢超過一年屬於 Pro 功能。升級後可查詢最近二年內投注資料。/);
    assert.match(source, /const proOldest = getOldestAllowedDate\(PRO_MAX_LOOKBACK_DAYS\);/);
    assert.match(source, /fromDay < proOldest \|\| rangeDays > PRO_MAX_LOOKBACK_DAYS/);
    assert.match(source, /目前最多支援查詢最近二年內的投注資料。/);

    const freeLimitIndex = source.indexOf("const freeOldest = getOldestAllowedDate(FREE_MAX_LOOKBACK_DAYS);");
    const proLimitIndex = source.indexOf("const proOldest = getOldestAllowedDate(PRO_MAX_LOOKBACK_DAYS);");
    assert.ok(freeLimitIndex > 0, "missing free limit check");
    assert.ok(proLimitIndex > freeLimitIndex, "pro two-year limit should run after the free one-year upgrade gate");
    assert.match(
        source,
        /if \(!pro\) \{[\s\S]*type: "pro"[\s\S]*查詢超過一年屬於 Pro 功能[\s\S]*\}[\s\S]*const proOldest = getOldestAllowedDate\(PRO_MAX_LOOKBACK_DAYS\);/
    );
});

test("pro prompt shows purchase, device copy, and activation controls", () => {
    assert.match(source, /function showProPrompt\(reason = "此功能需要 Pro。"\)/);
    assert.match(source, /promptEl\.id = "slb-pro-prompt";/);
    assert.match(source, /#slb-pro-prompt,/);
    assert.match(source, /#slb-pro-prompt\[data-theme="light"\],/);
    assert.match(cssBlock("#slb-pro-prompt"), /background:\s*var\(--slb-overlay,\s*rgba\(8,20,40,0\.86\)\)/);
    assert.doesNotMatch(source, /免費版可查詢最近一年，並可使用 24小時、7天、30天快捷查詢。/);
    assert.doesNotMatch(source, /購買時請透過 Line 官方帳號傳送下方本機裝置碼。/);
    assert.doesNotMatch(source, /付款確認後，會收到綁定這台裝置的啟動碼。/);
    assert.match(cssBlock(".slb-pro-dialog"), /position:\s*relative;/);
    assert.match(cssBlock(".slb-pro-close"), /position:\s*absolute;/);
    assert.match(cssBlock(".slb-pro-close"), /top:\s*12px;/);
    assert.match(cssBlock(".slb-pro-close"), /right:\s*12px;/);
    assert.match(source, /<button type="button" class="slb-pro-close" id="slb-close-pro-prompt" aria-label="關閉 Pro 提示">X<\/button>/);
    assert.doesNotMatch(source, /id="slb-close-pro-prompt">關閉<\/button>/);
    assert.match(source, /id="slb-pro-reason"/);
    assert.match(source, /const LINE_LOGO_RESOURCE = "assets\/LINE_logo\.svg\.webp";/);
    assert.match(source, /function getLineLogoUrl\(\)/);
    assert.match(source, /class="slb-line-logo-link" href="\$\{LINE_PURCHASE_URL\}"/);
    assert.match(source, /<img class="slb-line-logo" src="\$\{lineLogoUrl\}" alt="LINE">/);
    assert.match(source, /href="\$\{LINE_PURCHASE_URL\}"/);
    assert.match(source, />加入 LINE 好友<\/a>/);
    assert.match(source, /target="_blank" rel="noopener noreferrer"/);
    assert.match(source, /id="slb-pro-device-id"/);
    assert.match(source, /id="slb-copy-device-id"/);
    assert.match(source, /function flashProCopyButton\(button\)/);
    assert.match(source, /button\.textContent = "已複製";/);
    assert.doesNotMatch(source, /已複製本機裝置碼。/);
    assert.match(source, /id="slb-license-code-input"/);
    assert.match(source, /欲購買Pro版本請加入line好友並附上裝置碼/);
    assert.doesNotMatch(source, /啟用 Pro 後可查詢最近二年，並使用 1\/3\/6\/12 小時快捷查詢。/);
    assert.doesNotMatch(source, /目前為免費版。啟用 Pro 後/);
    assert.match(source, /placeholder="貼上啟動序號，例如 SLB2\.xxx\.yyy"/);
    assert.doesNotMatch(source, /placeholder="貼上啟動碼/);
    assert.match(source, /id="slb-activate-license-btn"/);
    assert.match(source, /await copyTextToClipboard\(getLicenseAuthorizationText\(\)\)/);
    assert.match(source, /const payload = await activateLicenseCode\(code\);/);
    assert.match(source, /啟用成功。授權：/);
    assert.match(source, /id="slb-pro-sync-status"/);
    assert.match(source, /function updateProSyncStatus\(\) \{[\s\S]*document\.getElementById\("slb-pro-sync-status"\)[\s\S]*syncEl\.textContent = licenseSyncStatus \|\| "";[\s\S]*syncEl\.classList\.toggle\("error", licenseSyncStatus === LICENSE_SYNC_FAILED_MESSAGE\);/);
    assert.match(source, /licenseSyncStatus = LICENSE_SYNCING_MESSAGE;[\s\S]*updateProSyncStatus\(\);[\s\S]*const payload = await activateLicenseCode\(code\);/);
    assert.match(source, /setProPromptStatus\(LICENSE_CHROME_LOGIN_MESSAGE, "error"\);/);

    const authBlock = functionBlock("getLicenseAuthorizationText");
    assert.match(authBlock, /return LICENSE_CHROME_LOGIN_MESSAGE;/);
    assert.match(authBlock, /const authorizationPayload = \{/);
    assert.match(authBlock, /accountId:\s*licenseAccountInfo\.accountId/);
    assert.match(authBlock, /email:\s*licenseAccountInfo\.email \|\| ""/);
    assert.match(authBlock, /app:\s*LICENSE_AUTH_APP/);
    assert.match(authBlock, /licenseVersion:\s*LICENSE_AUTH_VERSION/);
    assert.match(authBlock, /return `\$\{LICENSE_AUTH_REQUEST_PREFIX\}\.\$\{textToBase64Url\(JSON\.stringify\(authorizationPayload\)\)\}`;/);
    assert.doesNotMatch(authBlock, /return JSON\.stringify/);
    assert.doesNotMatch(authBlock, /deviceId/);
});

test("line logo asset is bundled for the pro prompt", () => {
    assert.ok(existsSync(join(__dirname, "..", "assets", "LINE_logo.svg.webp")));
    assert.match(manifestSource, /"assets\/LINE_logo\.svg\.webp"/);
});

test("long date searches are split into 30-day API chunks", () => {
    assert.match(source, /const DATE_CHUNK_FETCH_DELAY_MIN_MS = 1000;/);
    assert.match(source, /const DATE_CHUNK_FETCH_DELAY_MAX_MS = 2000;/);
    assert.match(source, /const maxRangeMs = 30 \* 24 \* 60 \* 60 \* 1000;/);
    assert.match(source, /let cursor = new Date\(end\);/);
    assert.match(source, /while \(cursor >= start\)/);
    assert.doesNotMatch(source, /chunks\.length < 24/);
    assert.match(source, /const dateChunks = requestedFromDate && requestedToDate && requestedFromDate <= requestedToDate[\s\S]*buildDateChunks\(requestedFromDate, requestedToDate\)/);
    assert.match(source, /type:\s*'SLB_FETCH_PROGRESS'/);
    assert.match(source, /await fetchState\("Opened", chunk\.from, chunk\.to\);/);
    assert.match(source, /await fetchState\("Settled", chunk\.from, chunk\.to\);/);
    assert.match(source, /while \(hasMore && pageNum < 50\)/);
    assert.match(source, /Math\.random\(\) \* \(max - min \+ 1\)/);
    assert.match(source, /if \(index < dateChunks\.length - 1\) \{[\s\S]*await sleep\(getDateChunkFetchDelayMs\(\)\);[\s\S]*\}/);
    assert.match(source, /fromStr:\s*requestedFromStr/);
    assert.match(source, /toStr:\s*requestedToStr/);
});

test("new searches cancel the currently loading segmented fetch", () => {
    assert.match(source, /let activeFetchController = null;/);
    assert.match(source, /let activeFetchRunId = "";/);
    assert.match(source, /if \(activeFetchController\) \{[\s\S]*activeFetchController\.abort\(\);[\s\S]*\}/);
    assert.match(source, /const fetchController = new AbortController\(\);/);
    assert.match(source, /fetchAllDataNatively\(cachedApiBaseUrl, cachedApiHeaders, queryStr, \{[\s\S]*fetchRunId,[\s\S]*signal: fetchController\.signal[\s\S]*\}\)/);
    assert.match(source, /if \(e\.data\.fetchRunId && parentFetchRunId && e\.data\.fetchRunId !== parentFetchRunId\) return;/);
    assert.match(source, /signal\?\.\addEventListener\("abort"/);
    assert.match(source, /signal\s*\}/);
});

test("loaded chunks are rendered before the full search completes", () => {
    assert.match(source, /partial:\s*true/);
    assert.match(source, /loadedCount:\s*localDatabase\.size/);
    assert.match(source, /bets:\s*Array\.from\(localDatabase\.values\(\)\)/);
    assert.match(source, /id="slb-header-progress-text"/);
    assert.match(source, /id="slb-header-progress-stage"/);
    assert.match(source, /id="slb-header-progress-loaded"/);
    assert.match(source, /function updateProgress\(text\)/);
    assert.match(source, /function updateProgressStage\(text\)/);
    assert.match(source, /function updateProgressLoaded\(text\)/);
    assert.match(source, /updateProgressLoaded\(""\);/);
    assert.doesNotMatch(source, /updateProgressLoaded\(`已載入：/);
    assert.match(source, /updateProgressStage\(`正在載入分段資料/);
    assert.doesNotMatch(source, /updateProgress\(`已先顯示目前載入資料/);
    assert.doesNotMatch(source, /updateProgress\(`正在載入分段資料/);
    assert.doesNotMatch(source, /updateStatus\(`已先顯示目前載入資料/);
    assert.doesNotMatch(source, /updateStatus\(`正在載入分段資料/);
    assert.match(source, /renderBets\(e\.data\.bets\);/);
});

test("unsettled bets do not show potential return as actual payout", () => {
    assert.match(
        source,
        /function getActualReturnDisplay\(bet\) \{[\s\S]*isSettledBet\(bet\) \? formatCurrency\(bet\.totalReturn \|\| 0\) : "-";/
    );
    assert.match(
        source,
        /function getNetProfitLoss\(bet\) \{[\s\S]*if \(!isSettledBet\(bet\)\) return null;/
    );
});

test("single-leg bets use leg odds when total odds are missing", () => {
    assert.match(
        source,
        /function getBetOddsValue\(bet\) \{[\s\S]*Number\(bet\.odds \?\? bet\.totalMultiBetOdds\)[\s\S]*Array\.isArray\(bet\.legs\) && bet\.legs\.length === 1[\s\S]*return getLegOddsValue\(bet\.legs\[0\]\);/
    );
});

test("multi-leg rows preserve and display per-leg settlement status", () => {
    assert.match(source, /function getLegStatusKey\(leg\)/);
    assert.match(source, /betLegStatus:\s*item\.betLegStatus/);
    assert.match(source, /winWLDOutcome:\s*item\.winWLDOutcome/);
    assert.match(source, /eventResult:\s*item\.eventResult/);
    assert.match(source, /slb-leg-status-icon-win/);
    assert.match(source, /slb-leg-status-icon-lose/);
    assert.match(source, /slb-leg-status-icon-pending/);
});
