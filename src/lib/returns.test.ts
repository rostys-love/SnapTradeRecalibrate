import { test } from "node:test";
import assert from "node:assert/strict";
import type { Activity } from "@/reconstruct/core";
import { accountReturns, combinedReturns, extractFlows, xirr } from "./returns";

const NOW = new Date("2026-10-01T00:00:00Z");
const id = (a: number) => a;
const act = (type: string, amount: number, date: string, extra: Partial<Activity> = {}): Activity =>
  ({ type, amount, units: 0, price: 0, currency: { code: "CAD" }, trade_date: `${date}T12:00:00Z`, ...extra });

test("xirr: one deposit growing 10% in exactly a year is 10%", () => {
  const r = xirr([{ date: "2025-10-01", amount: -1000 }, { date: "2026-10-01", amount: 1100 }], NOW)!;
  assert.ok(Math.abs(r - 0.1) < 0.002, String(r));
});

test("xirr: late deposits earn less time, so the rate is higher than the simple return", () => {
  // 1000 in two years ago, 1000 in one year ago, worth 2300 now (15% simple on 2000)
  const r = xirr(
    [{ date: "2024-10-01", amount: -1000 }, { date: "2025-10-01", amount: -1000 }, { date: "2026-10-01", amount: 2300 }],
    NOW,
  )!;
  assert.ok(r > 0.09 && r < 0.11, String(r)); // about 9.6%/yr
});

test("xirr: no sign change or too few flows gives null", () => {
  assert.equal(xirr([{ date: "2025-01-01", amount: -100 }], NOW), null);
  assert.equal(xirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: -50 }], NOW), null);
});

test("account returns: deposits, withdrawals, income, fees, gain and annual return", () => {
  const r = accountReturns(
    [
      act("CONTRIBUTION", 10000, "2023-10-01"),
      act("INTEREST", 250, "2024-10-01"),
      act("FEE", -12.5, "2024-11-30"),
      act("WITHDRAWAL", -1000, "2025-05-06"),
      act("INTERNAL_CASH_TRANSFER_IN", 1500, "2025-06-01"),
      act("DIVIDEND", 40, "2026-01-05", { symbol: { symbol: "ZAG.TO" } }),
      act("BUY", -500, "2026-01-06", { symbol: { symbol: "ZAG.TO" }, units: 10 }), // internal, not a flow
    ],
    12000,
    id,
    NOW,
  );
  assert.equal(r.depositsCad, 11500);
  assert.equal(r.withdrawalsCad, 1000);
  assert.equal(r.netDepositsCad, 10500);
  assert.equal(r.gainCad, 1500);
  assert.ok(Math.abs(r.totalReturnPct! - 14.2857) < 1e-3);
  assert.equal(r.interestCad, 250);
  assert.equal(r.feesCad, 12.5);
  assert.equal(r.dividendsCad, 40);
  assert.equal(r.since, "2023-10-01");
  assert.ok(r.annualReturnPct! > 4 && r.annualReturnPct! < 6, String(r.annualReturnPct));
  assert.deepEqual(r.warnings, []);
});

test("short history: total return shown, annual return withheld", () => {
  const r = accountReturns([act("CONTRIBUTION", 3000, "2026-08-17")], 3003.08, id, NOW);
  assert.equal(r.annualReturnPct, null);
  assert.ok(Math.abs(r.totalReturnPct! - 0.1027) < 1e-3);
});

test("flags in-kind transfers and history that starts mid-way", () => {
  const r = accountReturns(
    [
      act("SELL", 18911, "2024-04-16", { symbol: { symbol: "PSA.TO" }, units: -377 }),
      act("TRANSFER", 0, "2024-05-01", { symbol: { symbol: "XEQT.TO" }, units: 10 }),
      act("CONTRIBUTION", 300, "2025-08-19"),
    ],
    25000,
    id,
    NOW,
  );
  assert.ok(r.warnings.some((w) => w.includes("transfer of securities")));
  assert.ok(r.warnings.some((w) => w.includes("History seems to start after")));
});

test("USD amounts convert to CAD", () => {
  const { flows } = extractFlows(
    [{ ...act("CONTRIBUTION", 100, "2025-01-01"), currency: { code: "USD" } }],
    (a, c) => a * (c === "USD" ? 1.4 : 1),
  );
  assert.equal(flows[0].amountCad, 140);
});

test("combined returns cancel transfers between your own accounts", () => {
  const c = combinedReturns(
    [
      { flows: [{ date: "2024-10-01", amountCad: 1000 }, { date: "2025-10-01", amountCad: -400 }], valueCad: 700 },
      { flows: [{ date: "2025-10-01", amountCad: 400 }], valueCad: 450 },
    ],
    NOW,
  );
  assert.equal(c.netDepositsCad, 1000);
  assert.equal(c.gainCad, 150);
  assert.ok(Math.abs(c.annualReturnPct! - 7.2) < 0.2, String(c.annualReturnPct));
});
