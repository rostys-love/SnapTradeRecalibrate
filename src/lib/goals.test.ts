import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type AccountForGoals, type Goal, accountRate, addYears, allocationUsage, assignAccount, effectiveTarget,
  fvMonthly, positionToYears, projectGoal, sanitizeGoals, setShare, stressAccounts, yearsToPosition,
} from "./goals";

const NOW = new Date("2026-10-01T00:00:00Z");
const cash: AccountForGoals = { id: "cash", label: "Cash", valueCad: 20000, mix: [{ assetClass: "cash", value: 20000 }], pastReturnPct: 2.6 };
const stocks: AccountForGoals = { id: "stk", label: "Stocks", valueCad: 10000, mix: [{ assetClass: "equity", value: 10000 }], pastReturnPct: 11.4 };
const fresh: AccountForGoals = { id: "new", label: "New", valueCad: 3000, mix: [{ assetClass: "equity", value: 8 }, { assetClass: "bond", value: 2 }], pastReturnPct: null };
const ACCS = [cash, stocks, fresh];

const goal = (over: Partial<Goal>): Goal => ({
  id: "g", kind: "house", name: "House", target: 30000, date: addYears(NOW, 3), monthly: 0, sources: [], ...over,
});

test("account rate: past return when available and chosen, otherwise the mix", () => {
  assert.equal(accountRate(stocks, "past").rate, 0.114);
  assert.equal(accountRate(stocks, "mix").rate, 0.065);
  const f = accountRate(fresh, "past");
  assert.equal(f.source, "mix");                        // under a year of history
  assert.ok(Math.abs(f.rate - (0.8 * 0.065 + 0.2 * 0.035)) < 1e-12);
});

test("fvMonthly matches the annuity formula and handles zero rate", () => {
  assert.equal(fvMonthly(100, 0, 1), 1200);
  assert.ok(Math.abs(fvMonthly(100, 0.06, 1) - 1233.56) < 0.01);
  assert.equal(fvMonthly(100, 0.06, 0), 0);
});

test("projection: cash grows slowly with a tight range; status follows the low/expected values", () => {
  const p = projectGoal(goal({ sources: [{ accountId: "cash", share: 1 }], target: 21000 }), ACCS, "mix", NOW);
  assert.ok(Math.abs(p.years - 3) < 0.01);
  assert.equal(p.fundedNow, 20000);
  assert.ok(Math.abs(p.expected - 20000 * 1.025 ** p.years) < 1);
  assert.ok(p.high - p.low < 1000, "cash range is narrow");
  assert.equal(p.status, "on_track");
  const short = projectGoal(goal({ sources: [{ accountId: "cash", share: 1 }], target: 30000 }), ACCS, "mix", NOW);
  assert.equal(short.status, "short");
  assert.ok(short.gap > 8000);
  // closing the gap with extra monthly savings actually closes it
  const fixed = projectGoal(goal({ sources: [{ accountId: "cash", share: 1 }], target: 30000, monthly: short.extraMonthlyNeeded }), ACCS, "mix", NOW);
  assert.ok(Math.abs(fixed.expected - 30000) < 1, String(fixed.expected));
});

test("projection: stocks have a wider range, and short timelines on stocks are flagged", () => {
  const p = projectGoal(goal({ sources: [{ accountId: "stk", share: 1 }], date: addYears(NOW, 2) }), ACCS, "mix", NOW);
  assert.ok(p.high - p.low > 4000);
  assert.ok(p.low < p.fundedNow, "a bad 2 years can lose money");
  assert.ok(p.flags.some((f) => f.includes("under 3 years")));
});

test("projection: long goals in cash and emergency funds in stocks are flagged", () => {
  const longCash = projectGoal(goal({ kind: "retirement", date: addYears(NOW, 25), sources: [{ accountId: "cash", share: 1 }] }), ACCS, "mix", NOW);
  assert.ok(longCash.flags.some((f) => f.includes("rarely beats inflation")));
  const em = projectGoal(goal({ kind: "emergency", date: addYears(NOW, 0.1), sources: [{ accountId: "stk", share: 0.5 }] }), ACCS, "mix", NOW);
  assert.ok(em.flags.some((f) => f.includes("emergency fund")));
});

test("unfunded goals report as unfunded", () => {
  assert.equal(projectGoal(goal({}), ACCS, "mix", NOW).status, "unfunded");
});

test("emergency target comes from expenses × months", () => {
  assert.equal(effectiveTarget(goal({ kind: "emergency", monthlyExpenses: 2500, months: 4 })), 10000);
});

test("accounts can be split across goals but never exceed 100%", () => {
  let gs = [goal({ id: "a" }), goal({ id: "b" })];
  gs = assignAccount(gs, "a", "stk");
  assert.equal(gs[0].sources[0].share, 1);
  gs = setShare(gs, "a", "stk", 0.6);
  gs = assignAccount(gs, "b", "stk");                 // gets what's left
  assert.ok(Math.abs(gs[1].sources[0].share - 0.4) < 1e-9);
  gs = setShare(gs, "b", "stk", 0.9);                  // capped at 0.4
  assert.ok(Math.abs(gs[1].sources[0].share - 0.4) < 1e-9);
  assert.ok(Math.abs(allocationUsage(gs).get("stk")! - 1) < 1e-9);
  gs = setShare(gs, "a", "stk", 0);                    // removing frees it
  assert.equal(gs[0].sources.length, 0);
  assert.equal(assignAccount(gs, "a", "stk")[0].sources[0].share, 0.6);
});

test("timeline mapping is invertible and gives near-term goals more room", () => {
  for (const y of [0, 0.5, 1, 2, 4, 7, 15, 20]) assert.ok(Math.abs(positionToYears(yearsToPosition(y)) - y) < 1e-9, String(y));
  assert.equal(yearsToPosition(1), 20);
  assert.equal(yearsToPosition(50), 100);
});

test("stored goals are sanitized", () => {
  const gs = sanitizeGoals([
    { id: "x", kind: "house", name: "H", target: 1000, date: "2029-01-01", monthly: "50", sources: [{ accountId: "a", share: 2 }] },
    { id: "bad" },
    "junk",
    { id: "y", kind: "hacker", name: "<b>", target: -5, date: "nope", sources: null },
  ]);
  assert.equal(gs.length, 2);
  assert.equal(gs[0].monthly, 50);
  assert.equal(gs[0].sources[0].share, 1);
  assert.equal(gs[1].kind, "custom");
  assert.equal(gs[1].target, 0);
  assert.equal(sanitizeGoals("nope").length, 0);
});

test("tapping an account gives only what the goal still needs", () => {
  const em = goal({ id: "em", kind: "emergency", monthlyExpenses: 3000, months: 4, target: 0 }); // needs 12,000
  let gs = assignAccount([em], "em", "cash", ACCS);          // cash is 20,000
  assert.equal(gs[0].sources[0].share, 0.6);
  gs = setShare(gs, "em", "cash", 0.3);                       // covers 6,000
  gs = assignAccount(gs, "em", "stk", ACCS);                  // stocks 10,000 cover the other 6,000
  assert.equal(gs[0].sources.find((s) => s.accountId === "stk")!.share, 0.6);
  // without account data it falls back to everything that's free
  assert.equal(assignAccount([goal({ id: "x" })], "x", "cash")[0].sources[0].share, 1);
});

test("market drop: stocks fall, cash and bonds don't, and goals funded by stocks slip", () => {
  const mixed: AccountForGoals = { id: "mx", label: "Mixed", valueCad: 10000, pastReturnPct: null,
    mix: [{ assetClass: "equity", value: 6000 }, { assetClass: "bond", value: 3000 }, { assetClass: "cash", value: 1000 }] };
  const [c, s, m] = stressAccounts([cash, stocks, mixed], 0.2);
  assert.equal(c.valueCad, 20000);
  assert.equal(s.valueCad, 8000);
  assert.ok(Math.abs(m.valueCad - 8800) < 1e-9);
  assert.deepEqual(m.mix.map((x) => Math.round(x.value)), [4800, 3000, 1000]);
  assert.equal(stocks.valueCad, 10000, "the originals are not changed");
  // a goal that was just reachable on stocks is short after the drop
  const g = goal({ target: 12000, date: addYears(NOW, 3), sources: [{ accountId: "stk", share: 1 }] });
  assert.equal(projectGoal(g, ACCS, "mix", NOW).status, "likely");
  const after = projectGoal(g, stressAccounts(ACCS), "mix", NOW);
  assert.equal(after.status, "short");
  assert.ok(after.gap > 2000);
  // the same goal on cash is untouched
  const onCash = goal({ target: 12000, sources: [{ accountId: "cash", share: 0.6 }] });
  assert.equal(projectGoal(onCash, stressAccounts(ACCS), "mix", NOW).expected, projectGoal(onCash, ACCS, "mix", NOW).expected);
});
