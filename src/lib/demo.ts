// Sample data for the public demo. Everything here is invented: the person, the accounts, the trades
// and the prices. It is generated in the shape SnapTrade returns, so the demo runs through exactly the
// same pipeline as live data (rebuilding managed portfolios, cost basis, returns, goals, withdrawals).
// No network, no keys, nothing personal.
import type { Activity } from "@/reconstruct/core";
import type { Goal } from "./goals";
import type { MarketData } from "./positions";
import type { PortfolioSource } from "./portfolio-build";

export const DEMO_USD_CAD = 1.37;
export const DEMO_IDS = {
  tfsaManaged: "demo-tfsa-managed",
  rrspManaged: "demo-rrsp-managed",
  tfsaSelf: "demo-tfsa-self",
  cash: "demo-cash",
  loc: "demo-loc",
} as const;

interface Sec {
  name: string;
  cur: "CAD" | "USD";
  kind: "etf" | "stock";
  price: number;    // today, in `cur`
  growth: number;   // yearly drift used to back-fill past prices
  yield: number;    // yearly dividend yield
  beta: number;
  dayPct: number;
  phase: number;
}
const SEC: Record<string, Sec> = {
  "VFV.TO": { name: "Vanguard S&P 500 Index ETF", cur: "CAD", kind: "etf", price: 162.4, growth: 0.13, yield: 0.011, beta: 1.0, dayPct: 0.42, phase: 0.3 },
  "XIC.TO": { name: "iShares Core S&P/TSX Capped Composite Index ETF", cur: "CAD", kind: "etf", price: 45.1, growth: 0.09, yield: 0.028, beta: 0.95, dayPct: -0.18, phase: 1.1 },
  "XEF.TO": { name: "iShares Core MSCI EAFE IMI Index ETF", cur: "CAD", kind: "etf", price: 41.25, growth: 0.07, yield: 0.025, beta: 0.9, dayPct: 0.25, phase: 2.0 },
  "ZEM.TO": { name: "BMO MSCI Emerging Markets Index ETF", cur: "CAD", kind: "etf", price: 23.9, growth: 0.03, yield: 0.02, beta: 1.05, dayPct: -0.6, phase: 0.8 },
  "ZAG.TO": { name: "BMO Aggregate Bond Index ETF", cur: "CAD", kind: "etf", price: 13.85, growth: 0.008, yield: 0.034, beta: 0.2, dayPct: 0.05, phase: 2.6 },
  "XEQT.TO": { name: "iShares Core Equity ETF Portfolio", cur: "CAD", kind: "etf", price: 36.8, growth: 0.11, yield: 0.018, beta: 1.0, dayPct: 0.31, phase: 1.7 },
  "ENB.TO": { name: "Enbridge Inc.", cur: "CAD", kind: "stock", price: 61.2, growth: 0.08, yield: 0.062, beta: 0.8, dayPct: -0.35, phase: 0.1 },
  "SHOP.TO": { name: "Shopify Inc.", cur: "CAD", kind: "stock", price: 118.6, growth: -0.14, yield: 0, beta: 1.9, dayPct: 1.8, phase: 1.4 },
  "AC.TO": { name: "Air Canada", cur: "CAD", kind: "stock", price: 17.3, growth: -0.12, yield: 0, beta: 1.6, dayPct: -0.9, phase: 2.2 },
  NVDA: { name: "NVIDIA Corporation", cur: "USD", kind: "stock", price: 182.3, growth: 0.45, yield: 0, beta: 1.8, dayPct: 1.1, phase: 0.6 },
  AAPL: { name: "Apple Inc.", cur: "USD", kind: "stock", price: 241.5, growth: 0.16, yield: 0.004, beta: 1.2, dayPct: 0.2, phase: 2.9 },
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Price `m` months ago: steady drift plus a small repeatable wobble, so it looks like a market and never changes between loads. */
export function demoPrice(ticker: string, monthsAgo: number): number {
  const s = SEC[ticker];
  const wobble = 1 + 0.045 * (Math.sin(1.7 * monthsAgo + s.phase) - Math.sin(s.phase));
  return r2((s.price / Math.pow(1 + s.growth, monthsAgo / 12)) * wobble);
}

const figi = (ticker: string) => ticker.replace(/\W/g, "").padEnd(6, "X").slice(0, 6);
const symbol = (ticker: string) => ({
  symbol: ticker,
  description: SEC[ticker].name,
  currency: { code: SEC[ticker].cur },
  type: { code: SEC[ticker].kind === "etf" ? "et" : "cs" },
  figi_instrument: { figi_code: `DEMO${figi(ticker)}01`, figi_share_class: `DEMO${figi(ticker)}SC` },
});

/** Collects activities for one account and tracks its cash in CAD. */
class Ledger {
  readonly activities: Activity[] = [];
  readonly units = new Map<string, number>();
  cash = 0;
  private n = 0;
  constructor(private readonly id: string, private readonly now: Date) {}

  date(monthsAgo: number, day: number): string {
    return new Date(Date.UTC(this.now.getUTCFullYear(), this.now.getUTCMonth() - monthsAgo, day)).toISOString().slice(0, 10);
  }
  private push(a: Activity, cashCad: number) {
    this.activities.push({ id: `${this.id}-${++this.n}`, settlement_date: a.trade_date, ...a });
    this.cash = r2(this.cash + cashCad);
  }
  money(type: string, amount: number, m: number, day: number) {
    this.push({ type, amount: r2(amount), units: 0, price: 0, currency: { code: "CAD" }, trade_date: this.date(m, day) }, r2(amount));
  }
  /** Positive units buy, negative sell, at that month's price. Amounts are in the listing currency, as SnapTrade reports them. */
  trade(ticker: string, units: number, m: number, day: number) {
    const s = SEC[ticker];
    const price = demoPrice(ticker, m);
    const u = r4(units);
    const amount = r2(-u * price);
    this.units.set(ticker, r4((this.units.get(ticker) ?? 0) + u));
    this.push(
      { type: u > 0 ? "BUY" : "SELL", symbol: symbol(ticker), units: u, price, amount, currency: { code: s.cur }, trade_date: this.date(m, day) },
      amount * (s.cur === "USD" ? DEMO_USD_CAD : 1),
    );
  }
  dividends(m: number, day: number) {
    for (const [ticker, units] of this.units) {
      const s = SEC[ticker];
      const amount = r2((units * demoPrice(ticker, m) * s.yield) / 4);
      if (units <= 0 || amount < 0.01) continue;
      this.push(
        { type: "DIVIDEND", symbol: symbol(ticker), units: 0, price: 0, amount, currency: { code: s.cur }, trade_date: this.date(m, day) },
        amount * (s.cur === "USD" ? DEMO_USD_CAD : 1),
      );
    }
  }
  value(m: number): number {
    let v = 0;
    for (const [ticker, units] of this.units) v += units * demoPrice(ticker, m) * (SEC[ticker].cur === "USD" ? DEMO_USD_CAD : 1);
    return v;
  }
}

/** A robo-advisor style account: a deposit every month, swept into a fixed mix, with dividends and a small fee. */
function managedLedger(
  id: string, now: Date, months: number, initial: number, monthly: number,
  weights: (m: number) => Record<string, number>, extras?: (l: Ledger, m: number) => void,
): Ledger {
  const l = new Ledger(id, now);
  for (let m = months; m >= 1; m--) {
    l.money("CONTRIBUTION", m === months ? initial : monthly, m, 1);
    const spend = Math.max(0, l.cash - 20);
    for (const [ticker, w] of Object.entries(weights(m))) {
      if (w > 0 && spend > 1) l.trade(ticker, (spend * w) / demoPrice(ticker, m), m, 3);
    }
    extras?.(l, m);
    if (m % 3 === 0) l.dividends(m, 15);
    l.money("FEE", -(l.value(m) * 0.004) / 12, m, 25);
  }
  return l;
}

interface DemoData {
  accounts: any[];
  positions: Map<string, unknown>;
  balances: Map<string, any[]>;
  activities: Map<string, Activity[]>;
}

function generate(now: Date): DemoData {
  // TFSA, managed, growth mix. Held emerging markets early on, then dropped it; rebalanced once.
  const tfsa = managedLedger(
    DEMO_IDS.tfsaManaged, now, 38, 3000, 350,
    (m): Record<string, number> => (m > 18
      ? { "VFV.TO": 0.35, "XIC.TO": 0.2, "XEF.TO": 0.2, "ZEM.TO": 0.05, "ZAG.TO": 0.2 }
      : { "VFV.TO": 0.35, "XIC.TO": 0.2, "XEF.TO": 0.25, "ZAG.TO": 0.2 }),
    (l, m) => {
      if (m === 18) l.trade("ZEM.TO", -(l.units.get("ZEM.TO") ?? 0), m, 10);
      if (m === 14) {
        const sold = (l.units.get("VFV.TO") ?? 0) * 0.12;
        l.trade("VFV.TO", -sold, m, 10);
        l.trade("ZAG.TO", (sold * demoPrice("VFV.TO", m)) / demoPrice("ZAG.TO", m), m, 11);
      }
    },
  );

  // RRSP, managed, balanced mix
  const rrsp = managedLedger(
    DEMO_IDS.rrspManaged, now, 26, 2000, 200,
    () => ({ "VFV.TO": 0.2, "XIC.TO": 0.15, "XEF.TO": 0.15, "ZAG.TO": 0.5 }),
  );

  // Savings: regular deposits, monthly interest, one withdrawal for a car repair
  const cash = new Ledger(DEMO_IDS.cash, now);
  for (let m = 30; m >= 1; m--) {
    cash.money(m === 30 ? "DEPOSIT" : "CONTRIBUTION", m === 30 ? 6000 : 250, m, 2);
    if (m === 9) cash.money("WITHDRAWAL", -1800, m, 12);
    cash.money("INTEREST", (cash.cash * 0.0275) / 12, m, 28);
  }

  // TFSA, self-directed: a few stock picks, two of them since sold
  const self = new Ledger(DEMO_IDS.tfsaSelf, now);
  self.money("CONTRIBUTION", 6500, 22, 4);
  self.trade("NVDA", 12, 21, 6);
  self.trade("ENB.TO", 20, 21, 6);
  self.trade("AAPL", 8, 20, 9);
  self.dividends(18, 15);
  self.dividends(15, 15);
  self.money("CONTRIBUTION", 1500, 14, 4);
  self.trade("SHOP.TO", 8, 13, 7);
  self.trade("AC.TO", 30, 13, 7);
  self.dividends(12, 15);
  self.dividends(9, 15);
  self.trade("AAPL", -8, 8, 18);
  self.trade("AC.TO", -30, 6, 20);
  self.dividends(6, 15);
  self.trade("XEQT.TO", 40, 5, 8);
  self.dividends(3, 15);

  // Line of credit: borrowed a while ago, paying interest monthly
  const loc = new Ledger(DEMO_IDS.loc, now);
  for (let m = 8; m >= 1; m--) loc.money("INTEREST", -11.4, m, 27);

  const account = (id: string, number: string, rawType: string, unified: string, category: string, total: number) => ({
    id, number, raw_type: rawType, status: "open", account_category: category, institution_name: "Wealthsimple",
    brokerage_authorization: "demo-connection", is_paper: false,
    meta: { unifiedAccountType: unified }, balance: { total: { amount: r2(total), currency: "CAD" } },
  });
  const closed = (id: string, rawType: string) => ({ ...account(id, "0000", rawType, "SELF_DIRECTED_" + rawType, "INVESTMENT", 0), status: "closed" });

  const selfHoldings = [...self.units].filter(([, u]) => u > 0);
  const avgCost = (ticker: string) => {
    const buys = self.activities.filter((a) => a.type === "BUY" && a.symbol?.symbol === ticker);
    const units = buys.reduce((s, a) => s + Number(a.units), 0);
    return units > 0 ? r2(buys.reduce((s, a) => s + Number(a.units) * Number(a.price), 0) / units) : 0;
  };

  return {
    accounts: [
      account(DEMO_IDS.tfsaManaged, "DEMO1001", "TFSA", "MANAGED_PORTFOLIO_TFSA", "INVESTMENT", tfsa.value(0) + tfsa.cash),
      account(DEMO_IDS.rrspManaged, "DEMO1002", "RRSP", "MANAGED_PORTFOLIO_RRSP", "INVESTMENT", rrsp.value(0) + rrsp.cash),
      account(DEMO_IDS.tfsaSelf, "DEMO1003", "TFSA", "SELF_DIRECTED_TFSA", "INVESTMENT", self.value(0) + self.cash),
      account(DEMO_IDS.cash, "DEMO1004", "CASH", "MANAGED_SAVE", "DEPOSIT", cash.cash),
      account(DEMO_IDS.loc, "DEMO1005", "PERSONAL", "PORTFOLIO_LINE_OF_CREDIT", "LOC", -2400),
      closed("demo-closed-1", "PERSONAL"),
      closed("demo-closed-2", "TFSA"),
    ],
    // Managed portfolios come back with no positions, exactly as they do from Wealthsimple
    positions: new Map<string, unknown>([
      [DEMO_IDS.tfsaManaged, { results: [] }],
      [DEMO_IDS.rrspManaged, { results: [] }],
      [DEMO_IDS.cash, { results: [] }],
      [DEMO_IDS.tfsaSelf, {
        results: selfHoldings.map(([ticker, units]) => ({
          instrument: {
            kind: SEC[ticker].kind, symbol: ticker, description: SEC[ticker].name, currency: SEC[ticker].cur,
            figi_instrument: symbol(ticker).figi_instrument,
          },
          units: String(units), price: String(SEC[ticker].price), cost_basis: String(avgCost(ticker)), currency: SEC[ticker].cur,
        })),
      }],
    ]),
    balances: new Map([tfsa, rrsp, self, cash].map((l, i) => [
      [DEMO_IDS.tfsaManaged, DEMO_IDS.rrspManaged, DEMO_IDS.tfsaSelf, DEMO_IDS.cash][i],
      [{ currency: { code: "CAD" }, cash: l.cash }],
    ])),
    activities: new Map([
      [DEMO_IDS.tfsaManaged, tfsa.activities], [DEMO_IDS.rrspManaged, rrsp.activities], [DEMO_IDS.tfsaSelf, self.activities],
      [DEMO_IDS.cash, cash.activities], [DEMO_IDS.loc, loc.activities],
    ]),
  };
}

function demoMarket(ticker: string): MarketData | undefined {
  const s = SEC[ticker];
  if (!s) return undefined;
  const year = Array.from({ length: 13 }, (_, m) => demoPrice(ticker, m));
  const prevClose = r2(s.price / (1 + s.dayPct / 100));
  return {
    price: s.price, currency: s.cur, change: r2(s.price - prevClose), changePct: s.dayPct, prevClose,
    high52: r2(Math.max(...year) * 1.04), low52: r2(Math.min(...year) * 0.95), beta: s.beta,
  };
}

/** A PortfolioSource backed by the sample data. Dates are relative to `now`, so the demo never goes stale. */
export function demoSource(now: Date = new Date()): PortfolioSource {
  const data = generate(now);
  return {
    now,
    accounts: async () => data.accounts,
    connections: async () => [{ id: "demo-connection", brokerage: { display_name: "Wealthsimple" }, disabled: false, type: "read" }],
    positions: async (id) => data.positions.get(id) ?? { results: [] },
    balances: async (id) => data.balances.get(id) ?? [],
    activities: async (id) => data.activities.get(id) ?? [],
    rateToCad: async (currency) => {
      if (currency === "CAD") return 1;
      if (currency === "USD") return DEMO_USD_CAD;
      throw new Error(`No demo rate for ${currency}`);
    },
    marketData: async (tickers) => {
      const out = new Map<string, MarketData>();
      for (const t of tickers) {
        const d = demoMarket(t);
        if (d) out.set(t, d);
      }
      return out;
    },
    marketDataEnabled: true,
  };
}

/** Holdings the demo person treats as play money on the Calibrate page. */
export const DEMO_PLAY = ["SHOP.TO"];

/** Goals the demo opens with, so the timeline and the withdrawal planner have something to show. */
export function demoGoals(now: Date, cashTotal: number): Goal[] {
  const inMonths = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
  const emergency = 2800 * 4;
  return [
    {
      id: "demo-goal-emergency", kind: "emergency", name: "Emergency fund", target: emergency, monthlyExpenses: 2800, months: 4,
      date: inMonths(4), monthly: 0,
      sources: [{ accountId: DEMO_IDS.cash, share: Math.min(1, Math.ceil((emergency / Math.max(cashTotal, 1)) * 100) / 100) }],
    },
    {
      id: "demo-goal-trip", kind: "travel", name: "Trip to Japan", target: 4500, date: inMonths(11), monthly: 100,
      sources: [{ accountId: DEMO_IDS.tfsaSelf, share: 0.35 }],
    },
    {
      id: "demo-goal-house", kind: "house", name: "House down payment", target: 60000, date: inMonths(60), monthly: 400,
      sources: [{ accountId: DEMO_IDS.tfsaManaged, share: 1 }],
    },
  ];
}
