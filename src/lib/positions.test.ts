import { test } from "node:test";
import assert from "node:assert/strict";
import { accountKind, accountLabel, groupByAssetClass, normalizePositions, portfolioTotals } from "./positions";
import { createSessionValue, isValidSession } from "./session";
import { friendlyError } from "./errors";
import { attachDetails, attachMarket, previouslyHeld, rangePosition, splitResiduals, type HoldingRow, type MarketData } from "./positions";
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
  const base = { id: "", label: "", status: "live" as const, cashCad: 0, holdings: [], pastHoldings: [], byAssetClass: [], warnings: [] };
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

test("reads the SDK's `results` field (and the MCP connector's `positions`)", () => {
  const item = { instrument: { kind: "etf", symbol: "VFV.TO", description: "S&P 500" }, units: "2", price: "10", currency: "CAD" };
  const toCadId = (a: number) => a;
  assert.equal(normalizePositions({ results: [item], data_freshness: {} }, toCadId).length, 1, "SDK shape");
  assert.equal(normalizePositions({ positions: [item] }, toCadId).length, 1, "MCP shape");
  assert.equal(normalizePositions([item], toCadId).length, 1, "bare array");
  assert.equal(normalizePositions({}, toCadId).length, 0);
});

test("previously held: sold positions listed with realized gain; anything still held is excluded", () => {
  const s = (t: string, sc: string, d = "") => ({ symbol: t, description: d, figi_instrument: { figi_share_class: sc } });
  const H = buildHistories(
    [
      { type: "BUY", units: 10, price: 2, amount: -20, currency: { code: "CAD" }, trade_date: "2024-01-10", symbol: s("TWG", "SC-TWG", "Top Wealth") },
      { type: "SELL", units: -10, price: 0.5, amount: 5, currency: { code: "CAD" }, trade_date: "2025-03-01", symbol: s("TWG", "SC-TWG") },
      { type: "BUY", units: 2, price: 10, amount: -20, currency: { code: "CAD" }, trade_date: "2024-05-01", symbol: s("CMBT", "SC-CMBT", "Cmb.Tech") },
      { type: "SELL", units: -2, price: 30, amount: 60, currency: { code: "CAD" }, trade_date: "2026-02-01", symbol: s("CMBT", "SC-CMBT") },
      // still held, partly sold: must not appear
      { type: "BUY", units: 5, price: 100, amount: -500, currency: { code: "CAD" }, trade_date: "2024-01-01", symbol: s("VFV.TO", "SC-VFV") },
      { type: "SELL", units: -1, price: 120, amount: 120, currency: { code: "CAD" }, trade_date: "2025-01-01", symbol: s("VFV.TO", "SC-VFV") },
      // never sold: not "previously held" either
      { type: "BUY", units: 1, price: 50, amount: -50, currency: { code: "CAD" }, trade_date: "2024-01-01", symbol: s("APTX.TO", "SC-APTX") },
    ],
    undefined,
    new Date("2026-10-01T00:00:00Z"),
  );
  const current = [row({ key: "SC-VFV", ticker: "VFV.TO" })];
  const past = previouslyHeld(H, current);
  assert.deepEqual(past.map((p) => p.ticker), ["CMBT", "TWG"]); // newest sale first
  const cmbt = past[0];
  assert.equal(cmbt.name, "Cmb.Tech");
  assert.equal(cmbt.realizedGainCad, 40);
  assert.equal(cmbt.realizedPct, 200);
  assert.equal(cmbt.heldFor, "1 yr 9 mo");
  const twg = past[1];
  assert.equal(twg.realizedGainCad, -15);
  assert.equal(twg.realizedPct, -75);
});

test("a ticker still held under a different key is not listed as sold", () => {
  const H = buildHistories([
    { type: "BUY", units: 1, price: 10, amount: -10, currency: { code: "CAD" }, trade_date: "2024-01-01", symbol: { symbol: "EQX.TO" } },
    { type: "SELL", units: -0.5, price: 12, amount: 6, currency: { code: "CAD" }, trade_date: "2024-02-01", symbol: { symbol: "EQX.TO" } },
  ]);
  assert.equal(previouslyHeld(H, [row({ key: "FIGI-EQX", ticker: "EQX.TO" })]).length, 0);
});

test("rebuild leftovers under $1 are split out; unpriced rows are kept", () => {
  const { kept, residual } = splitResiduals([
    row({ ticker: "ZAG.TO", valueCad: 500 }),
    row({ ticker: "EQX.TO", valueCad: 0.06 }),
    row({ ticker: "NOPRICE", valueCad: 0, priceSource: "missing" }),
  ]);
  assert.deepEqual(kept.map((r) => r.ticker), ["ZAG.TO", "NOPRICE"]);
  assert.deepEqual(residual.map((r) => r.ticker), ["EQX.TO"]);
});
