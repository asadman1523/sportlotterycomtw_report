const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(join(__dirname, "..", "sportslottery-my-bets.user.js"), "utf8");

function cssBlock(selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, "m"));
    assert.ok(match, `Missing CSS block for ${selector}`);
    return match[1];
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

test("date shortcut buttons include 24 hours, 7 days, and 30 days", () => {
    assert.match(source, /id="slb-date-24h"[^>]*>24小時<\/button>/);
    assert.match(source, /id="slb-date-7d"[^>]*>7天<\/button>/);
    assert.match(source, /id="slb-date-30d"[^>]*>30天<\/button>/);
    assert.match(source, /setupHourShortcutButton\("slb-date-24h",\s*24\);/);
    assert.match(source, /setupDateShortcutButton\("slb-date-7d",\s*7\);/);
    assert.match(source, /setupDateShortcutButton\("slb-date-30d",\s*30\);/);
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
