import { test } from "node:test";
import assert from "node:assert/strict";
import { accountKind, accountLabel, groupByAssetClass, normalizePositions, portfolioTotals } from "./positions";
import { createSessionValue, isValidSession } from "./session";
import { friendlyError } from "./errors";
import { attachDetails, attachMarket, rangePosition, type HoldingRow, type MarketData } from "./positions";
import { buildHistories } from "./history";

// Shape copied from a live getAllAccountPositions response (values changed)
const RAW = {
  positions: [
    { instrument: { kind: "etf", symbol: "VFV.TO", description: "Vanguard S&P 500 Index ETF", currency: "CAD" },
      units: "10", price: "150", cost_basis: "100", currency: "CAD" },
    { instrument: { kind: "stock", symbol: "NVDA", description: "NVIDIA Corporation", currency: "USD" },
      units: "2", price: "200", cost_basis: "150", currency: "USD" },
    { instrument: { kind: "other", symbol: "GOLD", description: "Physically-backed gold", currency: "CAD" },
      units: "0.1", price: "5000", cost_basis: "6000", currency: "CAD" },
    { instrument: { kind: "etf", symbol: "ZERO", description: "Sold out", currency: "CAD" },
      units: "0", price: "10", cost_basis: "10", currency: "CAD" },
  ],
  data_freshness: { as_of: "2026-10-01T17:08:08Z" },
};
const toCad = (amt: number, cur: string) => amt * (cur === "USD" ? 1.4 : 1);

test("normalizes the unified positions schema with FX and gains", () => {
  const rows = normalizePositions(RAW, toCad);
  assert.deepEqual(rows.map((r) => r.ticker), ["VFV.TO", "NVDA", "GOLD"]); // sorted by value, zero units dropped
  const nvda = rows.find((r) => r.ticker === "NVDA")!;
  assert.equal(nvda.valueCad, 560);
  assert.equal(nvda.costCad, 420);
  assert.ok(Math.abs(nvda.gainPct! - 33.333) < 0.01);
  assert.equal(nvda.assetClass, "equity");
  const gold = rows.find((r) => r.ticker === "GOLD")!;
  assert.equal(gold.assetClass, "gold");
  assert.ok(gold.gainPct! < 0);
});

test("classifies Wealthsimple account types", () => {
  assert.equal(accountKind("MANAGED_PORTFOLIO_TFSA", "INVESTMENT"), "managed");
  assert.equal(accountKind("SELF_DIRECTED_TFSA", "INVESTMENT"), "self_directed");
  assert.equal(accountKind("CUSTOM_PORTFOLIO_NON_REGISTERED", "INVESTMENT"), "self_directed");
  assert.equal(accountKind("PORTFOLIO_LINE_OF_CREDIT", "LOC"), "line_of_credit");
  assert.equal(accountKind("MANAGED_SAVE", "DEPOSIT"), "cash");
  assert.equal(accountKind("CASH", "DEPOSIT"), "cash");
  assert.equal(accountKind(undefined, undefined), "other");
  assert.equal(accountLabel("TFSA", "managed"), "TFSA · Managed portfolio");
  assert.equal(accountLabel("PERSONAL", "line_of_credit"), "Line of credit");
});

test("totals treat a line of credit as a liability", () => {
  const base = { id: "", label: "", status: "live" as const, cashCad: 0, holdings: [], byAssetClass: [], warnings: [] };
  const t = portfolioTotals([
    { ...base, kind: "managed", totalCad: 1000 },
    { ...base, kind: "self_directed", totalCad: 500 },
    { ...base, kind: "line_of_credit", totalCad: -300 },
  ]);
  assert.deepEqual(t, { assets: 1500, liabilities: 300, net: 1200 });
});

test("groups by asset class and drops zero buckets", () => {
  const g = groupByAssetClass([
    { assetClass: "equity", value: 10 }, { assetClass: "bond", value: 5 },
    { assetClass: "equity", value: 2 }, { assetClass: "cash", value: 0 },
  ]);
  assert.deepEqual(g, [{ assetClass: "equity", value: 12 }, { assetClass: "bond", value: 5 }]);
});

test("session cookies verify, expire, and reject tampering", () => {
  process.env.SESSION_SECRET = "x".repeat(40);
  const now = 1_700_000_000_000;
  const v = createSessionValue(now);
  assert.ok(isValidSession(v, now + 1000));
  assert.ok(!isValidSession(v, now + 8 * 24 * 3600 * 1000), "expired after 7 days");
  const [exp, mac] = v.split(".");
  assert.ok(!isValidSession(`${Number(exp) + 999999}.${mac}`, now), "extended expiry rejected");
  assert.ok(!isValidSession(`${exp}.AAAA`, now), "bad signature rejected");
  assert.ok(!isValidSession(undefined, now));
  assert.ok(!isValidSession("garbage", now));
});

test("errors are one readable line without response headers", () => {
  const axiosLike = { message: "Request failed with status code 403\nRESPONSE HEADERS:\n{...}", response: { status: 403, data: "nope" } };
  assert.match(friendlyError(axiosLike), /^SnapTrade refused the request \(HTTP 403\)/);
  assert.equal(friendlyError({ response: { status: 400, data: { detail: "Invalid account" } } }), "Invalid account");
  assert.equal(friendlyError(new Error("first\nsecond")), "first");
});


const row = (over: Partial<HoldingRow>): HoldingRow => ({
  key: "K", marketEligible: true, ticker: "ZAG.TO", name: "Bond ETF", assetClass: "bond", units: 10,
  price: 15, currency: "CAD", valueCad: 150, costCad: null, gainPct: null, priceSource: "last_trade", ...over,
});
const hist = buildHistories(
  [
    { type: "BUY", units: 10, price: 13, amount: -130, currency: { code: "CAD" }, trade_date: "2024-03-01",
      symbol: { symbol: "ZAG.TO", figi_instrument: { figi_share_class: "K" } } },
    { type: "DIVIDEND", units: 0, price: 0, amount: 6.5, currency: { code: "CAD" }, trade_date: "2026-09-02",
      symbol: { symbol: "ZAG.TO", figi_instrument: { figi_share_class: "K" } } },
  ],
  undefined,
  new Date("2026-10-01T00:00:00Z"),
);

test("managed holdings get cost basis from history when units match", () => {
  const [r] = attachDetails([row({})], hist, new Date("2026-10-01T00:00:00Z"));
  assert.equal(r.costCad, 130);
  assert.ok(Math.abs(r.gainPct! - 15.3846) < 1e-3);
  assert.equal(r.detail!.costSource, "history");
  assert.equal(r.detail!.heldFor, "2 yr 7 mo");
  assert.equal(r.detail!.yieldOnCostPct, 5);
  assert.equal(r.detail!.historyComplete, true);
});

test("brokerage cost wins; history that doesn't explain the units is not used for cost", () => {
  const [kept] = attachDetails([row({ costCad: 120, gainPct: 25 })], hist);
  assert.equal(kept.costCad, 120);
  assert.equal(kept.detail!.costSource, "brokerage");
  const [mismatch] = attachDetails([row({ units: 25 })], hist);
  assert.equal(mismatch.costCad, null);
  assert.equal(mismatch.detail!.historyComplete, false);
  assert.equal(mismatch.detail!.firstBought, "2024-03-01"); // dates still shown
});

test("market data attaches only to eligible listings, with day change in CAD", () => {
  const m: MarketData = { price: 50, currency: "USD", change: 2, changePct: 4.17, prevClose: 48, high52: 60, low52: 40, beta: 1.2 };
  const market = new Map([["NVDA", m], ["GOLD", m]]);
  const toCadFx = (a: number, c: string) => a * (c === "USD" ? 1.4 : 1);
  const [nvda, gold] = attachMarket(
    [row({ ticker: "NVDA", units: 3 }), row({ ticker: "GOLD", marketEligible: false })],
    market,
    toCadFx,
  );
  assert.ok(Math.abs(nvda.dayChangeCad! - 8.4) < 1e-9);
  assert.equal(gold.market, undefined, "Wealthsimple's physical GOLD must not get Barrick's quote");
  assert.equal(rangePosition(m), 50);
  assert.equal(rangePosition({ ...m, high52: null }), null);
});

test("unified positions carry a FIGI key and market eligibility", () => {
  const rows = normalizePositions(
    { positions: [
      { instrument: { kind: "stock", symbol: "AMZN", figi_instrument: { figi_code: "F1", figi_share_class: "SC1" } }, units: "1", price: "200", currency: "USD" },
      { instrument: { kind: "other", symbol: "GOLD", description: "Physically-backed gold" }, units: "0.1", price: "5000", currency: "CAD" },
    ] },
    (a) => a,
  );
  assert.equal(rows.find((r) => r.ticker === "AMZN")!.key, "SC1");
  assert.equal(rows.find((r) => r.ticker === "AMZN")!.marketEligible, true);
  assert.equal(rows.find((r) => r.ticker === "GOLD")!.marketEligible, false);
});
