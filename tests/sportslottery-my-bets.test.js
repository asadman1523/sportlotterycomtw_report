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
    assert.match(cssBlock(".slb-content.expanded"), /white-space:\s*normal;/);
    assert.match(cssBlock(".slb-content.expanded"), /max-width:\s*400px;/);
    assert.match(cssBlock(".slb-content.expanded div.slb-content-leg"), /display:\s*block;/);
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
