import { test } from "node:test";
import assert from "node:assert/strict";
import { addYears, type Goal } from "./goals";
import {
  type CreditLine, type WithdrawAccount, type WithdrawInput, costFactor, grossForNet, planWithdrawal, withholdingRate,
} from "./withdraw";
import { accountTaxType } from "./positions";

const NOW = new Date("2026-10-02T00:00:00Z");
const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

const acct = (over: Partial<WithdrawAccount> & { id: string }): WithdrawAccount => ({
  label: over.id, valueCad: 10000, mix: [{ assetClass: "cash", value: 1 }], pastReturnPct: null,
  taxType: "tfsa", cashCad: 0, canPick: false, holdings: [], ...over,
});
const cash = acct({ id: "cash", taxType: "cash", valueCad: 20000 });
const managed = acct({ id: "tfsa-managed", valueCad: 15000, mix: [{ assetClass: "equity", value: 1 }] });
const rrsp = acct({ id: "rrsp", taxType: "rrsp", valueCad: 30000, mix: [{ assetClass: "equity", value: 1 }] });
const input = (over: Partial<WithdrawInput> = {}): WithdrawInput => ({
  amount: 5000, purpose: "other", repayMonths: 12, marginalRate: 0.3, locRate: 0.05, basis: "mix", ...over,
});
const goal = (over: Partial<Goal>): Goal => ({
  id: "g", kind: "house", name: "House", target: 20000, date: addYears(NOW, 5), monthly: 0, sources: [], ...over,
});
const LOC: CreditLine = { id: "loc", label: "Line of credit", owedCad: 2400 };

test("cost factor: repaid evenly vs never repaid", () => {
  near(costFactor(0.06, 12), (0.06 * 13) / 24, 1e-12);
  near(costFactor(0.06, null), 1.06 ** 10 - 1, 1e-12);
  assert.ok(costFactor(0.06, 3) < costFactor(0.06, 24));
});

test("RRSP withholding tiers and gross-up", () => {
  assert.equal(withholdingRate(5000), 0.1);
  assert.equal(withholdingRate(5000.01), 0.2);
  assert.equal(withholdingRate(15000.01), 0.3);
  near(grossForNet(4200), 4200 / 0.9);
  near(grossForNet(4600), 4600 / 0.8);   // 4600/0.9 would cross into the 20% tier
  near(grossForNet(12500), 12500 / 0.7);
});

test("cash is cheaper to give up than stocks, and the plan takes it first", () => {
  const p = planWithdrawal(input(), [managed, cash], [], null, NOW);
  assert.deepEqual(p.options.map((o) => o.sourceId), ["cash", "tfsa-managed"]);
  near(p.options[0].cost, 5000 * 0.025 * 13 / 24);
  near(p.options[1].cost, 5000 * 0.065 * 13 / 24);
  assert.equal(p.parts.length, 1);
  assert.equal(p.parts[0].sourceId, "cash");
  assert.equal(p.shortBy, 0);
  near(p.savesVsWorst!.amount, 5000 * 0.04 * 13 / 24);
  assert.equal(p.savesVsWorst!.label, "tfsa-managed");
});

test("not putting it back compounds the missed growth over ten years", () => {
  const p = planWithdrawal(input({ repayMonths: null }), [managed], [], null, NOW);
  near(p.cost, 5000 * (1.065 ** 10 - 1));
});

test("free money goes before money promised to a goal; taking more shows the damage", () => {
  const house = goal({ sources: [{ accountId: "cash", share: 0.8 }] });        // 16,000 promised, 4,000 free
  const ok = planWithdrawal(input({ amount: 4000 }), [cash], [house], null, NOW);
  assert.equal(ok.hits.length, 0);
  const hurt = planWithdrawal(input({ amount: 9000 }), [cash], [house], null, NOW);
  assert.equal(hurt.hits.length, 1);
  near(hurt.hits[0].lostNow, 5000);
  assert.ok(hurt.hits[0].gapAfter > hurt.hits[0].gapBefore);
  assert.ok(hurt.gapIncrease > 5000, "the shortfall grows by the lost money plus its growth");
});

test("the plan prefers a pricier free account over raiding a goal", () => {
  const house = goal({ sources: [{ accountId: "cash", share: 1 }] });
  const p = planWithdrawal(input(), [cash, managed], [house], null, NOW);
  assert.deepEqual(p.parts.map((x) => x.sourceId), ["tfsa-managed"]);
  assert.equal(p.hits.length, 0);
  // on its own, cash is still the cheapest single option, with the goal impact spelled out
  assert.equal(p.options[0].sourceId, "cash");
  assert.equal(p.options[0].hits.length, 1);
});

test("an emergency uses the emergency fund without counting it as damage", () => {
  const em = goal({ id: "em", kind: "emergency", name: "Emergency fund", target: 12000, sources: [{ accountId: "cash", share: 0.6 }] });
  const house = goal({ id: "h", sources: [{ accountId: "cash", share: 0.4 }] });
  const p = planWithdrawal(input({ purpose: "emergency", amount: 6000 }), [cash, managed], [em, house], null, NOW);
  assert.deepEqual(p.parts.map((x) => [x.sourceId, x.tier]), [["cash", 0]]);
  assert.equal(p.hits.length, 0);
  // the same amount for a planned purchase leaves the emergency fund alone
  const planned = planWithdrawal(input({ purpose: "other", amount: 6000 }), [cash, managed], [em, house], null, NOW);
  assert.deepEqual(planned.parts.map((x) => x.sourceId), ["tfsa-managed"]);
});

test("paying for a goal uses that goal's own money first", () => {
  const car = goal({ id: "car", kind: "car", name: "Car", target: 8000, sources: [{ accountId: "tfsa-managed", share: 0.5 }] });
  const p = planWithdrawal(input({ purpose: { goalId: "car" }, amount: 7000 }), [cash, managed], [car], null, NOW);
  assert.equal(p.parts[0].sourceId, "tfsa-managed");
  assert.equal(p.parts[0].tier, 0);
  assert.equal(p.hits.length, 0);
});

test("RRSP: grossed up for withholding, taxed at the marginal rate, and used last", () => {
  const only = planWithdrawal(input({ amount: 4000 }), [rrsp], [], null, NOW);
  const t = only.parts[0];
  near(t.gross, 4000 / 0.9);
  near(t.withholding, t.gross * 0.1);
  near(t.net, 4000);
  near(t.taxCost, 0.3 * t.gross);
  assert.equal(t.tier, 3);
  // even money promised to a goal goes before the RRSP
  const house = goal({ sources: [{ accountId: "cash", share: 1 }] });
  const p = planWithdrawal(input({ amount: 4000 }), [rrsp, cash], [house], null, NOW);
  assert.deepEqual(p.parts.map((x) => x.sourceId), ["cash"]);
  assert.equal(p.hits.length, 1);
});

test("FHSA is tax-free for a house goal and taxed otherwise", () => {
  const fhsa = acct({ id: "fhsa", taxType: "fhsa", valueCad: 8000 });
  const house = goal({ id: "h", sources: [{ accountId: "fhsa", share: 1 }] });
  const forHouse = planWithdrawal(input({ purpose: { goalId: "h" } }), [fhsa], [house], null, NOW);
  assert.equal(forHouse.parts[0].taxCost, 0);
  near(forHouse.parts[0].gross, 5000);
  const other = planWithdrawal(input(), [fhsa], [house], null, NOW);
  assert.ok(other.parts[0].taxCost > 1000);
  assert.ok(other.parts[0].gross > 5000);
});

test("self-directed: cash first, then the slowest growers; taxable gains are taxed", () => {
  const sd = acct({
    id: "sd", taxType: "taxable", canPick: true, valueCad: 10000, cashCad: 1000,
    mix: [{ assetClass: "equity", value: 6000 }, { assetClass: "bond", value: 3000 }, { assetClass: "cash", value: 1000 }],
    holdings: [
      { ticker: "STK", name: "Stock", assetClass: "equity", valueCad: 6000, costCad: 3000 },
      { ticker: "BND", name: "Bond", assetClass: "bond", valueCad: 3000, costCad: 3000 },
    ],
  });
  const p = planWithdrawal(input({ amount: 5000 }), [sd], [], null, NOW);
  assert.deepEqual(p.parts[0].sells.map((s) => [s.ticker, Math.round(s.amount)]), [["Cash", 1000], ["BND", 3000], ["STK", 1000]]);
  near(p.parts[0].taxCost, 500 * 0.5 * 0.3);       // 1,000 of a holding that is half gain
  near(p.parts[0].growthLost, (1000 * 0.025 + 3000 * 0.035 + 1000 * 0.065) * 13 / 24);
  // a losing position creates no tax and is flagged in a registered account
  const reg = acct({ id: "reg", canPick: true, valueCad: 4000, holdings: [{ ticker: "DOWN", name: "Down", assetClass: "equity", valueCad: 4000, costCad: 5000 }] });
  const q = planWithdrawal(input({ amount: 2000 }), [reg], [], null, NOW);
  assert.equal(q.parts[0].taxCost, 0);
  assert.ok(q.parts[0].notes.some((n) => n.includes("locks in about $500")));
});

test("splits across accounts when one isn't enough, and reports a shortfall", () => {
  const small = acct({ id: "small", taxType: "cash", valueCad: 3000 });
  const p = planWithdrawal(input({ amount: 8000 }), [small, managed], [], null, NOW);
  assert.deepEqual(p.parts.map((x) => [x.sourceId, Math.round(x.net)]), [["tfsa-managed", 5000], ["small", 3000]]);
  near(p.covered, 8000);
  assert.equal(p.options.find((o) => o.sourceId === "small")!.feasible, false);
  const short = planWithdrawal(input({ amount: 50000 }), [small, managed], [], null, NOW);
  near(short.shortBy, 32000);
  assert.equal(short.savesVsWorst, null);
});

test("line of credit: after spare money, against goal money on cost, never without a plan to repay", () => {
  // spare stocks go first even though borrowing is cheaper on paper
  assert.deepEqual(planWithdrawal(input(), [managed], [], LOC, NOW).parts.map((x) => x.sourceId), ["tfsa-managed"]);
  // stocks promised to a goal (6.5%) cost more than the loan (5%): borrow and leave the goal alone
  const onStocks = goal({ sources: [{ accountId: "tfsa-managed", share: 1 }] });
  const p = planWithdrawal(input(), [managed], [onStocks], LOC, NOW);
  assert.deepEqual(p.parts.map((x) => x.sourceId), ["loc"]);
  near(p.interest, 5000 * 0.05 * 13 / 24);
  assert.equal(p.hits.length, 0);
  // cash promised to a goal (2.5%) is cheaper than the loan, so it's used and the goal impact is shown
  const onCash = goal({ sources: [{ accountId: "cash", share: 1 }] });
  const q = planWithdrawal(input(), [cash], [onCash], LOC, NOW);
  assert.deepEqual(q.parts.map((x) => x.sourceId), ["cash"]);
  assert.equal(q.hits.length, 1);
  assert.deepEqual(planWithdrawal(input(), [cash, managed], [], LOC, NOW).options.map((o) => o.sourceId), ["cash", "loc", "tfsa-managed"]);
  // not putting it back: no borrowing in the plan, and the loan is listed last
  const never = planWithdrawal(input({ repayMonths: null }), [managed], [onStocks], LOC, NOW);
  assert.deepEqual(never.parts.map((x) => x.sourceId), ["tfsa-managed"]);
  assert.equal(never.options.at(-1)!.sourceId, "loc");
});

test("managed investments take a few days; cash is right away", () => {
  const withHoldings = acct({ id: "m", valueCad: 9000, holdings: [{ ticker: "ETF", name: "ETF", assetClass: "equity", valueCad: 9000, costCad: 8000 }] });
  const p = planWithdrawal(input({ amount: 1000 }), [withHoldings, cash], [], null, NOW);
  assert.equal(p.options.find((o) => o.sourceId === "m")!.speed, "A few business days");
  assert.equal(p.options.find((o) => o.sourceId === "cash")!.speed, "Right away");
});

test("locked accounts are left out and named", () => {
  const resp = acct({ id: "resp", label: "RESP", taxType: "locked" });
  const p = planWithdrawal(input(), [resp, cash], [], null, NOW);
  assert.deepEqual(p.excluded, ["RESP"]);
  assert.ok(!p.options.some((o) => o.sourceId === "resp"));
});

test("account tax type from the brokerage's labels", () => {
  assert.equal(accountTaxType("TFSA", "MANAGED_PORTFOLIO_TFSA", "managed"), "tfsa");
  assert.equal(accountTaxType("TFSA", "HISA_TFSA", "cash"), "tfsa");
  assert.equal(accountTaxType("RRSP", "SELF_DIRECTED_RRSP", "self_directed"), "rrsp");
  assert.equal(accountTaxType("FHSA", undefined, "managed"), "fhsa");
  assert.equal(accountTaxType("RESP", "SELF_DIRECTED_RESP", "self_directed"), "locked");
  assert.equal(accountTaxType("LIRA", undefined, "managed"), "locked");
  assert.equal(accountTaxType("CASH", "MANAGED_SAVE", "cash"), "cash");
  assert.equal(accountTaxType("PERSONAL", "SELF_DIRECTED_PERSONAL", "self_directed"), "taxable");
  assert.equal(accountTaxType("CRYPTO", undefined, "other"), "taxable");
});
