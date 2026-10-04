import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortfolio } from "./portfolio-build";
import { DEMO_IDS, demoGoals, demoPrice, demoSource } from "./demo";
import { portfolioTotals } from "./positions";
import { projectGoal } from "./goals";
import { planWithdrawal, type WithdrawAccount } from "./withdraw";

const NOW = new Date("2026-10-02T15:00:00Z");
const build = () => buildPortfolio(demoSource(NOW));

test("demo: the whole pipeline runs on the sample data with nothing flagged", async () => {
  const p = await build();
  assert.equal(p.accounts.length, 5);
  assert.equal(p.hiddenAccounts, 2);
  for (const a of p.accounts) {
    assert.equal(a.error, undefined, a.label);
    assert.deepEqual(a.warnings, [], a.label);
  }
  assert.deepEqual(
    p.accounts.map((a) => a.label).sort(),
    ["Cash", "Line of credit", "RRSP · Managed · Balanced", "TFSA · Managed · Growth", "TFSA · Self-directed"],
  );
  const t = portfolioTotals(p.accounts);
  assert.ok(t.assets > 40000 && t.assets < 60000, String(t.assets));
  assert.equal(t.liabilities, 2400);
  // what the Overview's "Built on SnapTrade" strip reports
  assert.equal(p.stats.rebuiltAccounts, 2);
  assert.equal(p.stats.holdings, 12);
  assert.ok(p.stats.tradesRead > 200 && p.stats.tradesRead < p.stats.activitiesRead);
});

test("demo: managed portfolios come with no positions and are rebuilt from history to the reported total", async () => {
  const src = demoSource(NOW);
  assert.deepEqual(await src.positions(DEMO_IDS.tfsaManaged), { results: [] });
  const p = await buildPortfolio(src);
  for (const id of [DEMO_IDS.tfsaManaged, DEMO_IDS.rrspManaged]) {
    const a = p.accounts.find((x) => x.id === id)!;
    assert.equal(a.status, "reconstructed");
    const rebuilt = a.holdings.reduce((s, h) => s + h.valueCad, 0) + a.cashCad;
    assert.ok(Math.abs(rebuilt - a.totalCad) < 1, `${rebuilt} vs ${a.totalCad}`);
    assert.ok(a.cashCad >= 0);
    for (const h of a.holdings) {
      assert.equal(h.priceSource, "quote");
      assert.equal(h.detail?.costSource, "history");
      assert.ok(h.market, h.ticker);
    }
  }
  const tfsa = p.accounts.find((x) => x.id === DEMO_IDS.tfsaManaged)!;
  assert.deepEqual(tfsa.pastHoldings.map((h) => h.ticker), ["ZEM.TO"]);
  assert.ok(tfsa.returns!.annualReturnPct! > 3 && tfsa.returns!.annualReturnPct! < 20);
});

test("demo: self-directed account has live positions, a loser, and two sold holdings", async () => {
  const a = (await build()).accounts.find((x) => x.id === DEMO_IDS.tfsaSelf)!;
  assert.equal(a.status, "live");
  assert.ok(a.cashCad > 0);
  assert.deepEqual(a.holdings.map((h) => h.ticker).sort(), ["ENB.TO", "NVDA", "SHOP.TO", "XEQT.TO"]);
  assert.ok(a.holdings.find((h) => h.ticker === "SHOP.TO")!.gainPct! < 0);
  assert.equal(a.holdings.find((h) => h.ticker === "NVDA")!.currency, "USD");
  assert.ok(a.holdings.every((h) => h.detail?.historyComplete));
  assert.deepEqual(a.pastHoldings.map((h) => h.ticker).sort(), ["AAPL", "AC.TO"]);
  assert.ok(Math.abs(a.holdings.reduce((s, h) => s + h.valueCad, 0) + a.cashCad - a.totalCad) < 1);
});

test("demo: seeded goals and the withdrawal planner work on the sample accounts", async () => {
  const p = await build();
  const funded = p.accounts.filter((a) => a.kind !== "line_of_credit");
  const accounts = funded.map((a): WithdrawAccount => ({
    id: a.id, label: a.label, valueCad: a.totalCad, mix: a.byAssetClass, pastReturnPct: a.returns?.annualReturnPct ?? null,
    taxType: a.taxType!, cashCad: a.cashCad, canPick: a.kind === "self_directed",
    holdings: a.holdings.map((h) => ({ ticker: h.ticker, name: h.name, assetClass: h.assetClass, valueCad: h.valueCad, costCad: h.costCad })),
  }));
  const goals = demoGoals(NOW, p.accounts.find((a) => a.id === DEMO_IDS.cash)!.totalCad);
  assert.equal(goals.length, 3);
  for (const g of goals) {
    assert.ok(g.date > "2026-10-02");
    assert.notEqual(projectGoal(g, accounts, "mix", NOW).status, "unfunded");
  }
  const plan = planWithdrawal(
    { amount: 3000, purpose: "emergency", repayMonths: 12, marginalRate: 0.3, locRate: 0.05, basis: "mix" },
    accounts, goals, { id: DEMO_IDS.loc, label: "Line of credit", owedCad: 2400 }, NOW,
  );
  assert.deepEqual(plan.parts.map((x) => [x.sourceId, x.tier]), [[DEMO_IDS.cash, 0]]);
  assert.equal(plan.hits.length, 0);
  assert.equal(plan.options.at(-1)!.taxType, "rrsp");
});

test("demo: prices are repeatable and today's price is the listed one", () => {
  assert.equal(demoPrice("VFV.TO", 0), 162.4);
  assert.equal(demoPrice("NVDA", 12), demoPrice("NVDA", 12));
  assert.ok(demoPrice("NVDA", 24) < demoPrice("NVDA", 0));
});

test("demo: generated activities are all in the past", async () => {
  const src = demoSource(NOW);
  for (const id of Object.values(DEMO_IDS)) {
    for (const a of await src.activities(id)) assert.ok(a.trade_date! < "2026-10-02", `${id} ${a.trade_date}`);
  }
});

test("paper-trading accounts hold pretend money and are left out of everything", async () => {
  const base = demoSource(NOW);
  const withPaper = {
    ...base,
    accounts: async () => [
      ...(await base.accounts()),
      { id: "paper-1", number: "P1", raw_type: null, status: "open", account_category: "INVESTMENT", is_paper: true,
        brokerage_authorization: "paper-connection", meta: { type: "Margin" }, balance: { total: { amount: 100000, currency: "USD" } } },
    ],
    connections: async () => [
      ...(await base.connections()),
      { id: "paper-connection", brokerage: { display_name: "Paper Broker" }, disabled: false, type: "trade" },
    ],
  };
  const [plain, p] = await Promise.all([buildPortfolio(base), buildPortfolio(withPaper)]);
  assert.equal(p.paperAccounts, 1);
  assert.equal(plain.paperAccounts, 0);
  assert.equal(p.hiddenAccounts, plain.hiddenAccounts, "not counted as a closed account either");
  assert.deepEqual(p.accounts.map((a) => a.id), plain.accounts.map((a) => a.id));
  assert.deepEqual(portfolioTotals(p.accounts), portfolioTotals(plain.accounts));
  assert.deepEqual(p.connections.map((c) => c.brokerage), ["Wealthsimple"], "a paper-only connection isn't listed");
  assert.equal(p.connections[0].canTrade, false);
});
