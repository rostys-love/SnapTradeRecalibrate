import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "@/reconstruct/core";
import { buildHistories, heldFor, historyMatches } from "./history";

const ZAG = {
  symbol: "ZAG.TO", description: "BMO Aggregate Bond Index ETF", currency: { code: "CAD" },
  figi_instrument: { figi_code: "BBG000Q7M9P4", figi_share_class: "BBG001T6N7H3" },
};
const GLOV = { symbol: "GLOV", description: "World Equity", currency: { code: "USD" }, figi_instrument: { figi_share_class: "SC-GS" } };
const GSWO = { ...GLOV, symbol: "GSWO" };

const act = (type: string, symbol: any, units: number, price: number, amount: number, date: string): Activity =>
  ({ type, symbol, units, price, amount, currency: { code: "CAD" }, trade_date: `${date}T15:00:00Z` });

const NOW = new Date("2026-10-01T12:00:00Z");

test("average cost, realized gain and holding dates", () => {
  const h = buildHistories([
    act("BUY", ZAG, 10, 13, -130, "2024-03-01"),
    act("BUY", ZAG, 10, 15, -150, "2025-03-01"),   // avg now 14
    act("SELL", ZAG, -5, 16, 80, "2025-06-01"),    // realized 80 - 5*14 = 10
    act("DIVIDEND", ZAG, 0, 0.04, 3, "2025-07-02"), // older than 12 months
    act("DIVIDEND", ZAG, 0, 0.04, 4, "2026-09-02"),
  ], undefined, NOW).get("BBG001T6N7H3")!;

  assert.equal(h.units, 15);
  assert.equal(h.avgCostCad, 14);
  assert.equal(h.totalCostCad, 210);
  assert.equal(h.realizedGainCad, 10);
  assert.equal(h.buyCount, 2);
  assert.equal(h.firstBought, "2024-03-01");
  assert.equal(h.lastBought, "2025-03-01");
  assert.equal(h.heldSince, "2024-03-01");
  assert.equal(h.dividendsTotalCad, 7);
  assert.equal(h.dividends12mCad, 4);
  assert.equal(h.lastDividend, "2026-09-02");
  assert.deepEqual(h.trades.map((t) => t.type), ["SELL", "BUY", "BUY"]); // newest first
});

test("selling out resets the position; buying back restarts heldSince", () => {
  const h = buildHistories([
    act("BUY", ZAG, 10, 13, -130, "2023-01-01"),
    act("SELL", ZAG, -10, 14, 140, "2024-01-01"),
    act("BUY", ZAG, 4, 12, -48, "2025-05-05"),
  ], undefined, NOW).get("BBG001T6N7H3")!;
  assert.equal(h.heldSince, "2025-05-05");
  assert.equal(h.firstBought, "2023-01-01");
  assert.equal(h.avgCostCad, 12);
  assert.equal(h.realizedGainCad, 10);
});

test("ticker renames share one history; falls back to units x price when amount is 0", () => {
  const map = buildHistories([
    act("BUY", GLOV, 1, 75, 0, "2025-06-01"),
    act("BUY", GSWO, 1, 85, -85, "2026-01-26"),
  ], undefined, NOW);
  assert.equal(map.size, 1);
  const h = map.get("SC-GS")!;
  assert.equal(h.ticker, "GSWO");
  assert.equal(h.totalCostCad, 160);
});

test("amounts convert to CAD with the given rate", () => {
  const usd = { ...act("BUY", GSWO, 2, 50, -100, "2026-01-01"), currency: { code: "USD" } };
  const h = buildHistories([usd], (a, c) => a * (c === "USD" ? 1.4 : 1), NOW).get("SC-GS")!;
  assert.equal(h.totalCostCad, 140);
});

test("history must explain held units to be trusted", () => {
  const h = buildHistories([act("BUY", ZAG, 10, 13, -130, "2024-03-01")], undefined, NOW).get("BBG001T6N7H3")!;
  assert.ok(historyMatches(h, 10.05));
  assert.ok(!historyMatches(h, 12));
  assert.ok(!historyMatches(undefined, 10));
});

test("heldFor formats durations", () => {
  assert.equal(heldFor("2024-07-01", NOW), "2 yr 3 mo");
  assert.equal(heldFor("2026-05-01", NOW), "5 mo");
  assert.equal(heldFor("2026-09-20", NOW), "11 days");
  assert.equal(heldFor("2024-10-01", NOW), "2 yr");
  assert.equal(heldFor(null, NOW), null);
});
