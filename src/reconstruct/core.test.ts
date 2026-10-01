import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Activity, aggregateHoldings, classifyAssetClass, estimateFromProfile,
  paginate, reconcile, valueHoldings,
} from "./core";

// Fixtures mirror real SnapTrade activity shapes (GSWO was formerly GLOV, same FIGI share class)
const sym = (symbol: string, description: string, shareClass: string, typeCode = "et", currency = "CAD") => ({
  symbol, description, currency: { code: currency }, type: { code: typeCode },
  figi_code: shareClass + "X", figi_instrument: { figi_code: shareClass + "X", figi_share_class: shareClass },
});
const GLOV = sym("GLOV", "Goldman Sachs ActiveBeta World Equity ETF", "BBG0155MNF86", "et", "USD");
const GSWO = sym("GSWO", "Goldman Sachs ActiveBeta World Equity ETF", "BBG0155MNF86", "cs", "USD");
const ZAG = sym("ZAG.TO", "BMO Aggregate Bond Index ETF", "BBG001T6N7H3");
const PSA = sym("PSA.TO", "Purpose High Interest Savings Fund", "BBG005DLRGH4");

const act = (type: string, s: any, units: number | string, price: number, date: string): Activity =>
  ({ type, symbol: s, units, price, amount: -Number(units) * price, trade_date: date });

test("merges a ticker rename by FIGI share class and keeps the latest ticker", () => {
  const { holdings, warnings } = aggregateHoldings([
    act("BUY", GSWO, 0.3309, 81.08, "2026-01-26"),
    act("BUY", GLOV, 1.0, 75.0, "2025-06-01"),   // older record, out of order on purpose
    act("SELL", GSWO, -0.3988, 87.11, "2026-05-27"),
  ]);
  assert.equal(holdings.length, 1);
  assert.equal(holdings[0].ticker, "GSWO");
  assert.deepEqual(holdings[0].tickersSeen, ["GLOV", "GSWO"]);
  assert.ok(Math.abs(holdings[0].units - 0.9321) < 1e-9);
  assert.equal(holdings[0].lastTradePrice, 87.11);
  assert.ok(warnings.some((w) => w.includes("GLOV → GSWO")));
});

test("string units parse, fully sold positions drop out", () => {
  const { holdings } = aggregateHoldings([
    act("BUY", PSA, "377.2047", 50.0, "2023-01-10"),
    act("SELL", PSA, "-377.2047", 50.14, "2024-04-16"),
    act("BUY", ZAG, "16.7651", 13.54, "2026-08-20"),
  ]);
  assert.deepEqual(holdings.map((h) => h.ticker), ["ZAG.TO"]);
});

test("ignores cash-only activities and corrects inverted signs", () => {
  const { holdings, warnings } = aggregateHoldings([
    { type: "INTEREST", symbol: null, units: 0, amount: 55.94, trade_date: "2026-08-01" },
    { type: "DIVIDEND", symbol: ZAG, units: 0, price: 0.039, amount: 3.01, trade_date: "2026-08-05" },
    act("BUY", ZAG, 10, 13.5, "2026-01-01"),
    act("SELL", ZAG, 4, 13.7, "2026-02-01"),   // positive units on a SELL
  ]);
  assert.equal(holdings[0].units, 6);
  assert.ok(warnings.some((w) => w.includes("SELL with positive units")));
});

test("flags unknown unit-changing types and negative net positions", () => {
  const { warnings, unitTypesSeen } = aggregateHoldings([
    act("JOURNAL", ZAG, 5, 13, "2026-01-01"),
    act("SELL", PSA, -2, 50, "2026-01-02"),
  ]);
  assert.equal(unitTypesSeen.JOURNAL, 1);
  assert.ok(warnings.some((w) => w.includes('Unrecognized activity type "JOURNAL"')));
  assert.ok(warnings.some((w) => w.includes("PSA.TO nets to negative units")));
});

test("classifies asset classes from descriptions", () => {
  assert.equal(classifyAssetClass("BMO High Yield U.S. Corporate Bond Hedged to CAD Index ETF", "ZHY.TO", "et"), "bond");
  assert.equal(classifyAssetClass("BMO U.S. Aggregate Bond Index Hedged Fund", "ZUAG.F.TO", "et"), "bond");
  assert.equal(classifyAssetClass("Purpose High Interest Savings Fund", "PSA.TO", "et"), "cash");
  assert.equal(classifyAssetClass("BMO Gold Bullion ETF", "ZGLD.TO", "et"), "gold");
  assert.equal(classifyAssetClass("Mackenzie US Large Cap Equity Fund", "QUU.TO", "et"), "equity");
  assert.equal(classifyAssetClass("Bitcoin", "BTC", "crypto"), "crypto");
});

test("paginates until total is reached and refuses runaway paging", async () => {
  const data = Array.from({ length: 2500 }, (_, i) => i);
  const pages: number[] = [];
  const all = await paginate(async (offset, limit) => {
    pages.push(offset);
    return { items: data.slice(offset, offset + limit), total: data.length };
  }, 1000);
  assert.equal(all.length, 2500);
  assert.deepEqual(pages, [0, 1000, 2000]);

  await assert.rejects(
    paginate(async () => ({ items: [1, 2] }), 2, 3),
    /exceeded 3 pages/,
  );
});

test("values with quotes first, last trade second, and converts currency", () => {
  const { holdings } = aggregateHoldings([
    act("BUY", ZAG, 100, 13.5, "2026-01-01"),
    act("BUY", GSWO, 10, 80, "2026-01-01"),
  ]);
  const quotes = new Map([["GSWO", { price: 90, currency: "USD" }]]);
  const toBase = (amt: number, cur: string) => amt * (cur === "USD" ? 1.4 : 1);
  const valued = valueHoldings(holdings, quotes, toBase, "CAD");
  const zag = valued.find((h) => h.ticker === "ZAG.TO")!;
  const gswo = valued.find((h) => h.ticker === "GSWO")!;
  assert.equal(zag.priceSource, "last_trade");
  assert.equal(zag.value, 1350);
  assert.equal(gswo.priceSource, "quote");
  assert.ok(Math.abs(gswo.value - 1260) < 1e-9);
});

test("reconcile: within tolerance, outside tolerance, no reference", () => {
  assert.equal(reconcile(9900, 200, 10000).status, "reconstructed");    // +1%
  const off = reconcile(8000, 0, 10000);
  assert.equal(off.status, "mismatch");
  assert.equal(Math.round(off.diffPct!), -20);
  assert.equal(reconcile(500, 0, 0).status, "no_reference");
});

test("profile fallback sums to the reported total", () => {
  for (const p of ["cash", "conservative", "balanced", "growth"] as const) {
    const sum = estimateFromProfile(10000, p).reduce((s, r) => s + r.value, 0);
    assert.ok(Math.abs(sum - 10000) < 1e-6, p);
  }
});
