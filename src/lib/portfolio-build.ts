// Turns raw brokerage data into the dashboard's view model. It only talks to a PortfolioSource, so the
// same code runs on live SnapTrade data (portfolio.ts) and on the sample data behind the demo (demo.ts).
import { reconstructAccount, type PriceProvider } from "@/reconstruct/snaptrade";
import { num, type Activity } from "@/reconstruct/core";
import { buildHistories } from "./history";
import { accountReturns, combinedReturns, extractFlows } from "./returns";
import { friendlyError as errMsg } from "./errors";
import {
  AccountSummary, HoldingRow, MarketData, accountKind, accountLabel, accountTaxType, instrumentOf, attachDetails, attachMarket,
  disambiguateLabels, groupByAssetClass, normalizePositions, positionList, previouslyHeld, splitResiduals,
} from "./positions";

export interface ConnectionStatus {
  id: string;
  brokerage: string;
  disabled: boolean;
}

/** Where the raw data comes from. Shapes follow SnapTrade's REST responses. */
export interface PortfolioSource {
  accounts(): Promise<any[]>;
  connections(): Promise<any[]>;
  positions(accountId: string): Promise<unknown>;
  balances(accountId: string): Promise<any[]>;
  activities(accountId: string): Promise<Activity[]>;
  rateToCad(currency: string): Promise<number>;
  marketData(tickers: string[]): Promise<Map<string, MarketData>>;
  marketDataEnabled: boolean;
  now?: Date;
}

export interface Portfolio {
  fetchedAt: string;
  connections: ConnectionStatus[];
  accounts: AccountSummary[];
  hiddenAccounts: number;    // closed, archived, or under $1
  /** What it took to build this view, shown on the Overview. */
  stats: { activitiesRead: number; tradesRead: number; rebuiltAccounts: number; holdings: number };
  marketDataEnabled: boolean;
  combined: ReturnType<typeof combinedReturns> | null;
}

async function buildToCad(src: PortfolioSource, currencies: Set<string>) {
  const rates = new Map<string, number>([["CAD", 1]]);
  const warnings: string[] = [];
  for (const c of currencies) {
    if (rates.has(c)) continue;
    try {
      rates.set(c, await src.rateToCad(c));
    } catch (e) {
      warnings.push(`No ${c}→CAD rate (${errMsg(e)}); ${c} amounts shown as 0.`);
      rates.set(c, 0);
    }
  }
  return { toCad: (amt: number, cur: string) => amt * (rates.get(cur) ?? 0), warnings };
}

/** Price provider that also remembers what it fetched, so rows can show it. */
function marketPriceProvider(src: PortfolioSource, seen: Map<string, MarketData>): PriceProvider {
  return async (tickers) => {
    const data = await src.marketData(tickers);
    for (const [t, d] of data) seen.set(t, d);
    return new Map([...data].map(([t, d]) => [t, { price: d.price, currency: d.currency }]));
  };
}

const historyStats = (activities: Activity[]) => ({
  activities: activities.length,
  trades: activities.filter((x) => ["BUY", "SELL"].includes((x.type ?? "").toUpperCase())).length,
});

async function loadAccount(src: PortfolioSource, a: any): Promise<AccountSummary> {
  const now = src.now ?? new Date();
  const unified: string | undefined = a.meta?.unifiedAccountType;
  const kind = accountKind(unified, a.account_category);
  const totalCurrency: string = a.balance?.total?.currency ?? "CAD";
  const base: AccountSummary = {
    id: a.id,
    label: accountLabel(a.raw_type, kind),
    kind,
    taxType: accountTaxType(a.raw_type, unified, kind),
    status: "live",
    totalCad: num(a.balance?.total?.amount),
    cashCad: 0,
    holdings: [],
    pastHoldings: [],
    byAssetClass: [],
    warnings: [],
  };
  if (totalCurrency !== "CAD") {
    base.totalCad *= await src.rateToCad(totalCurrency);
  }

  if (kind === "line_of_credit") {
    // Only the cost of borrowing matters here: interest and fees charged
    try {
      const acts = await src.activities(a.id);
      base.history = historyStats(acts);
      const { toCad } = await buildToCad(src, new Set(acts.map((x) => x.currency?.code ?? "CAD")));
      base.returns = accountReturns(acts, base.totalCad, toCad, now);
      base.returns.warnings = [];
    } catch (e) {
      base.warnings.push(`Borrowing history unavailable (${errMsg(e)}).`);
    }
    return base;
  }

  const [positionsRes, balancesRes, activitiesRes] = await Promise.allSettled([
    src.positions(a.id),
    src.balances(a.id),
    src.activities(a.id),
  ]);
  if (positionsRes.status === "rejected") throw positionsRes.reason;
  if (balancesRes.status === "rejected") throw balancesRes.reason;
  const rawPositions: any = positionsRes.value;
  const balances: any[] = balancesRes.value ?? [];
  let activities: Activity[] = [];
  if (activitiesRes.status === "fulfilled") activities = activitiesRes.value;
  else base.warnings.push(`Activity history unavailable (${errMsg(activitiesRes.reason)}); purchase details hidden.`);
  base.history = historyStats(activities);

  // Every currency we might convert: positions, cash, activity amounts, and USD for US listings
  const currencies = new Set<string>(["USD"]);
  for (const p of positionList(rawPositions)) currencies.add(p?.currency ?? "CAD");
  for (const b of balances) currencies.add(b?.currency?.code ?? "CAD");
  for (const act of activities) if (act.currency?.code) currencies.add(act.currency.code);
  const { toCad, warnings: fxWarnings } = await buildToCad(src, currencies);
  base.warnings.push(...fxWarnings);
  base.cashCad = balances.reduce((s, b) => s + toCad(num(b?.cash), b?.currency?.code ?? "CAD"), 0);

  const histories = buildHistories(activities, toCad, now);
  if (activities.length) {
    base.returns = accountReturns(activities, base.totalCad, toCad, now);
    base.flows = extractFlows(activities, toCad).flows;
  }

  const live = normalizePositions(rawPositions, toCad);

  // Only managed portfolios are rebuilt from history: SnapTrade gives them no positions. Every other
  // account uses Wealthsimple's positions as the truth, even when that list is empty (all cash).
  if (kind !== "managed" || live.length > 0) {
    const market = await src.marketData(live.filter((h) => h.marketEligible).map((h) => h.ticker));
    base.holdings = attachMarket(attachDetails(live, histories, now), market, toCad);
    base.pastHoldings = previouslyHeld(histories, base.holdings);
    base.byAssetClass = groupByAssetClass([
      ...live.map((h) => ({ assetClass: h.assetClass, value: h.valueCad })),
      { assetClass: "cash", value: kind === "cash" ? base.totalCad - live.reduce((s, h) => s + h.valueCad, 0) : base.cashCad },
    ]);
    return base;
  }

  const seen = new Map<string, MarketData>();
  // Everything is prefetched, so the rebuild makes no API calls of its own
  const view = await reconstructAccount(null, a.id, {
    fxProvider: async (from, to) => {
      if (from === to) return 1;
      if (to !== "CAD") throw new Error(`Only CAD conversion is supported (asked ${from}→${to})`);
      return src.rateToCad(from);
    },
    priceProvider: src.marketDataEnabled ? marketPriceProvider(src, seen) : undefined,
    fallbackProfile: "balanced",
    prefetched: { activities, balances, total: a.balance?.total ?? null },
  });
  base.status = view.status;
  base.cashCad = view.cash;
  base.warnings.push(...view.warnings);
  const rows = view.holdings.map(
    (h): HoldingRow => ({
      key: h.key,
      // Wealthsimple-held assets (e.g. physical gold) share tickers with unrelated public listings
      marketEligible: h.assetClass !== "crypto" && !/physically[- ]backed/i.test(h.description),
      ticker: h.ticker,
      name: h.description,
      assetClass: h.assetClass,
      instrument: instrumentOf(h.typeCode, h.description),
      units: h.units,
      price: h.price,
      currency: h.priceSource === "quote" ? h.listingCurrency : view.currency,
      valueCad: h.value,
      costCad: null,
      gainPct: null,
      priceSource: h.priceSource,
    }),
  );
  const { kept, residual } = splitResiduals(rows);
  if (residual.length) {
    base.warnings.push(
      `Hid ${residual.length} rounding leftover${residual.length > 1 ? "s" : ""} under $1 from the rebuild: ${residual.map((r) => r.ticker).join(", ")}.`,
    );
  }
  base.holdings = attachMarket(attachDetails(kept, histories, now), seen, toCad);
  base.pastHoldings = previouslyHeld(histories, base.holdings);
  base.byAssetClass = groupByAssetClass(view.byAssetClass);
  return base;
}

export async function buildPortfolio(src: PortfolioSource): Promise<Portfolio> {
  const now = src.now ?? new Date();
  const [all, rawConnections] = await Promise.all([src.accounts(), src.connections()]);

  const connections: ConnectionStatus[] = rawConnections.map((c) => ({
    id: c.id,
    brokerage: c.brokerage?.display_name ?? c.brokerage?.name ?? "Brokerage",
    disabled: Boolean(c.disabled),
  }));

  const visible = all.filter((a) => a.status === "open" && Math.abs(num(a.balance?.total?.amount)) >= 1);

  const results = await Promise.allSettled(visible.map((a) => loadAccount(src, a)));
  const accounts = results.map((r, i): AccountSummary => {
    if (r.status === "fulfilled") return r.value;
    const a = visible[i];
    const kind = accountKind(a.meta?.unifiedAccountType, a.account_category);
    return {
      id: a.id, label: accountLabel(a.raw_type, kind), kind, taxType: accountTaxType(a.raw_type, a.meta?.unifiedAccountType, kind), status: "error",
      totalCad: num(a.balance?.total?.amount), cashCad: 0, holdings: [], pastHoldings: [], byAssetClass: [],
      warnings: [], error: errMsg(r.reason),
    };
  });

  // Several "TFSA · Managed portfolio" accounts are common at Wealthsimple: name them by mix, then number
  disambiguateLabels(
    accounts.map((acc, i) => Object.assign(acc, { numberSuffix: String(visible[i]?.number ?? "").replace(/\W/g, "").slice(-4) || undefined })),
  );
  for (const acc of accounts) delete (acc as any).numberSuffix;

  const order = { managed: 0, self_directed: 1, cash: 2, other: 3, line_of_credit: 4 } as const;
  accounts.sort((x, y) => order[x.kind] - order[y.kind] || y.totalCad - x.totalCad);

  return {
    fetchedAt: now.toISOString(),
    connections,
    accounts,
    hiddenAccounts: all.length - visible.length,
    stats: {
      activitiesRead: accounts.reduce((s, x) => s + (x.history?.activities ?? 0), 0),
      tradesRead: accounts.reduce((s, x) => s + (x.history?.trades ?? 0), 0),
      rebuiltAccounts: accounts.filter((x) => x.kind === "managed" && !["live", "error"].includes(x.status)).length,
      holdings: accounts.reduce((s, x) => s + x.holdings.length, 0),
    },
    marketDataEnabled: src.marketDataEnabled,
    combined: (() => {
      const invest = accounts.filter((x) => x.kind !== "line_of_credit" && x.flows?.length);
      return invest.length ? combinedReturns(invest.map((x) => ({ flows: x.flows!, valueCad: x.totalCad })), now) : null;
    })(),
  };
}
