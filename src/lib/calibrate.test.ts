import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, type CalHolding, bucketOf, calibrate, customPreset } from "./calibrate";
import { instrumentOf } from "./positions";
import { buildPortfolio } from "./portfolio-build";
import { demoSource } from "./demo";

const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const h = (over: Partial<CalHolding> & { ticker: string; valueCad: number }): CalHolding => ({
  accountId: "sd", accountLabel: "TFSA · Self-directed", taxType: "tfsa", canPick: true, name: over.ticker,
  assetClass: "equity", instrument: "stock", costCad: null, ...over,
});
const RULE = PRESETS.find((p) => p.id === "rule-30-30-30-10")!;
const CLASSIC = PRESETS.find((p) => p.id === "classic-60-40")!;
const group = (c: ReturnType<typeof calibrate>, id: string) => c.groups.find((g) => g.id === id)!;

test("buckets: nothing counts twice, and cash or gold sit outside the rule", () => {
  const none = new Set<string>();
  assert.equal(bucketOf({ ticker: "NVDA", assetClass: "equity", instrument: "stock" }, none), "stocks");
  assert.equal(bucketOf({ ticker: "VFV.TO", assetClass: "equity", instrument: "fund" }, none), "funds");
  assert.equal(bucketOf({ ticker: "ZAG.TO", assetClass: "bond", instrument: "fund" }, none), "bonds", "a bond ETF is bonds, not a stock fund");
  assert.equal(bucketOf({ ticker: "BTC", assetClass: "crypto", instrument: "other" }, none), "play");
  assert.equal(bucketOf({ ticker: "NVDA", assetClass: "equity", instrument: "stock" }, new Set(["NVDA"])), "play", "tagged by you");
  assert.equal(bucketOf({ ticker: "GOLD", assetClass: "gold", instrument: "other" }, none), null);
  assert.equal(bucketOf({ ticker: "CASH", assetClass: "cash", instrument: "other" }, none), null);
});

test("stock or fund comes from the brokerage's type, then from the name", () => {
  assert.equal(instrumentOf("etf", ""), "fund");
  assert.equal(instrumentOf("et", ""), "fund");
  assert.equal(instrumentOf("stock", ""), "stock");
  assert.equal(instrumentOf("cs", ""), "stock");
  assert.equal(instrumentOf(undefined, "iShares Core Equity ETF Portfolio"), "fund");
  assert.equal(instrumentOf(undefined, "Enbridge Inc."), "stock");
  assert.equal(instrumentOf("other", "Physically-backed gold"), "other");
});

test("gaps are measured against invested money only", () => {
  const c = calibrate(
    [
      h({ ticker: "A", valueCad: 6000 }),
      h({ ticker: "F", valueCad: 2000, instrument: "fund" }),
      h({ ticker: "B", valueCad: 2000, assetClass: "bond", instrument: "fund" }),
      h({ ticker: "GOLD", valueCad: 5000, assetClass: "gold", instrument: "other" }),
    ],
    RULE,
  );
  assert.equal(c.invested, 10000);
  assert.equal(c.outside, 5000);
  near(group(c, "stocks").diff, 3000);
  near(group(c, "funds").diff, -1000);
  near(group(c, "bonds").diff, -1000);
  near(group(c, "play").diff, -1000);
  assert.equal(group(c, "stocks").status, "over");
  assert.equal(c.balanced, false);
});

test("moves: sell what's over, buy what's under, inside the same account", () => {
  const c = calibrate(
    [
      h({ ticker: "BIG", valueCad: 4000, costCad: 3000 }),
      h({ ticker: "SMALL", valueCad: 2000, costCad: 2500 }),
      h({ ticker: "F", valueCad: 2000, instrument: "fund" }),
      h({ ticker: "B", valueCad: 2000, assetClass: "bond", instrument: "fund" }),
    ],
    RULE,
  );
  assert.equal(c.moves.length, 1);
  const m = c.moves[0];
  assert.equal(m.taxFree, true);
  assert.deepEqual(m.sells.map((s) => [s.ticker, Math.round(s.amount)]), [["BIG", 3000]]);
  near(m.sells[0].gain!, 750);
  assert.deepEqual(m.buys.map((b) => [b.groupId, Math.round(b.amount)]), [["funds", 1000], ["bonds", 1000], ["play", 1000]]);
  assert.deepEqual(m.buys[0].have, ["F"]);
  assert.equal(m.buys[2].what, "your play-money picks");
  near(c.shift, 3000);
  assert.equal(c.stuck, 0);
  assert.equal(m.taxableGain, 0, "no tax inside a TFSA");
});

test("taxable accounts sell after sheltered ones, and losers before winners", () => {
  const tax = { accountId: "tx", accountLabel: "Personal", taxType: "taxable" as const };
  const c = calibrate(
    [
      h({ ticker: "WIN", valueCad: 3000, costCad: 1000, ...tax }),
      h({ ticker: "LOSE", valueCad: 3000, costCad: 4000, ...tax }),
      h({ ticker: "SHELTERED", valueCad: 1000, costCad: 500 }),
      h({ ticker: "B", valueCad: 3000, assetClass: "bond", instrument: "fund" }),
    ],
    CLASSIC, // stock side is 7,000 of 10,000; target 6,000
  );
  const sells = c.moves.flatMap((m) => m.sells.map((s) => [s.ticker, Math.round(s.amount)]));
  assert.deepEqual(sells, [["SHELTERED", 1000]]);
  // with more to sell, the taxable account gives up its loser first
  const d = calibrate(
    [
      h({ ticker: "WIN", valueCad: 4000, costCad: 1000, ...tax }),
      h({ ticker: "LOSE", valueCad: 3000, costCad: 4000, ...tax }),
      h({ ticker: "SHELTERED", valueCad: 1000, costCad: 500 }),
      h({ ticker: "B", valueCad: 2000, assetClass: "bond", instrument: "fund" }),
    ],
    CLASSIC, // stock side 8,000 of 10,000; 2,000 over
  );
  assert.deepEqual(d.moves.flatMap((m) => m.sells.map((s) => [s.ticker, Math.round(s.amount)])), [["SHELTERED", 1000], ["LOSE", 1000]]);
  assert.ok(d.moves.find((m) => m.accountId === "tx")!.taxableGain < 0);
});

test("managed accounts count in the mix but can't be traded; the remainder is reported as stuck", () => {
  const managed = { accountId: "m", accountLabel: "TFSA · Managed · Growth", canPick: false };
  const c = calibrate(
    [
      h({ ticker: "VFV.TO", valueCad: 8000, instrument: "fund", ...managed }),
      h({ ticker: "XEQT.TO", valueCad: 1000, instrument: "fund" }),
      h({ ticker: "ZAG.TO", valueCad: 1000, assetClass: "bond", instrument: "fund", ...managed }),
    ],
    CLASSIC, // 9,000 stock side vs 6,000 target: 3,000 over, only 1,000 of it tradable
  );
  assert.deepEqual(c.moves.flatMap((m) => m.sells.map((s) => [s.ticker, s.amount])), [["XEQT.TO", 1000]]);
  near(c.stuck, 2000);
  assert.deepEqual(c.stuckIn, ["TFSA · Managed · Growth"]);
});

test("within 1% (or $100) counts as on target, with nothing to do", () => {
  const c = calibrate(
    [h({ ticker: "F", valueCad: 6050, instrument: "fund" }), h({ ticker: "B", valueCad: 3950, assetClass: "bond", instrument: "fund" })],
    CLASSIC,
  );
  assert.equal(c.balanced, true);
  assert.equal(c.moves.length, 0);
  assert.equal(c.stuck, 0);
});

test("tagging a holding as play money moves it between buckets", () => {
  const hs = [h({ ticker: "NVDA", valueCad: 5000 }), h({ ticker: "ENB", valueCad: 5000 })];
  assert.equal(group(calibrate(hs, RULE), "play").current, 0);
  const tagged = calibrate(hs, RULE, new Set(["NVDA"]));
  assert.equal(group(tagged, "play").current, 5000);
  assert.equal(group(tagged, "stocks").current, 5000);
});

test("custom targets are scaled to 100%", () => {
  const p = customPreset({ stocks: 20, funds: 20, bonds: 10, play: 0 });
  assert.deepEqual(p.groups.map((g) => g.pct), [40, 40, 20, 0]);
  assert.deepEqual(customPreset({ stocks: 0, funds: 0, bonds: 0, play: 0 }).groups.map((g) => g.pct), [25, 25, 25, 25]);
  for (const preset of PRESETS) near(preset.groups.reduce((s, g) => s + g.pct, 0), 100);
});

test("demo: every sample holding lands in a bucket and the rule produces moves", async () => {
  const p = await buildPortfolio(demoSource(new Date("2026-10-04T15:00:00Z")));
  const holdings = p.accounts.flatMap((a) => a.holdings.map((x): CalHolding => ({
    accountId: a.id, accountLabel: a.label, taxType: a.taxType!, canPick: a.kind === "self_directed", ticker: x.ticker, name: x.name,
    assetClass: x.assetClass, instrument: x.instrument!, valueCad: x.valueCad, costCad: x.costCad,
  })));
  assert.equal(holdings.length, 12);
  for (const x of holdings) assert.notEqual(bucketOf(x, new Set()), null, x.ticker);
  assert.equal(holdings.find((x) => x.ticker === "VFV.TO")!.instrument, "fund");
  assert.equal(holdings.find((x) => x.ticker === "NVDA")!.instrument, "stock");
  const c = calibrate(holdings, RULE, new Set(["SHOP.TO"]));
  assert.equal(group(c, "funds").status, "over");
  assert.deepEqual(c.moves.map((m) => m.accountLabel), ["TFSA · Self-directed"]);
  assert.deepEqual(c.moves[0].sells.map((s) => s.ticker), ["XEQT.TO"]);
  assert.ok(c.stuck > 1000, "most of the excess is inside managed portfolios");
  near(c.groups.reduce((s, g) => s + g.current, 0), c.invested);
});
