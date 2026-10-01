import "server-only";
import { reconstructAccount, fetchAllActivities, type PriceProvider } from "@/reconstruct/snaptrade";
import { num, type Activity } from "@/reconstruct/core";
import { snaptrade } from "./snaptrade";
import { fxProvider, rateToCad } from "./fx";
import { getMarketData } from "./finnhub";
import { buildHistories } from "./history";
import { friendlyError as errMsg } from "./errors";
import {
  AccountSummary, HoldingRow, MarketData, accountKind, accountLabel, attachDetails, attachMarket,
  groupByAssetClass, normalizePositions, positionList, previouslyHeld, splitResiduals,
} from "./positions";

export interface ConnectionStatus {
  id: string;
  brokerage: string;
  disabled: boolean;
}

export interface Portfolio {
  fetchedAt: string;
  connections: ConnectionStatus[];
  accounts: AccountSummary[];
  hiddenAccounts: number;    // closed, archived, or empty
  marketDataEnabled: boolean;
}

async function buildToCad(currencies: Set<string>) {
  const rates = new Map<string, number>([["CAD", 1]]);
  const warnings: string[] = [];
  for (const c of currencies) {
    if (rates.has(c)) continue;
    try {
      rates.set(c, await rateToCad(c));
    } catch (e) {
      warnings.push(`No ${c}→CAD rate (${errMsg(e)}); ${c} amounts shown as 0.`);
      rates.set(c, 0);
    }
  }
  return { toCad: (amt: number, cur: string) => amt * (rates.get(cur) ?? 0), warnings };
}

/** Finnhub-backed price provider that also remembers what it fetched, so rows can show it. */
function marketPriceProvider(seen: Map<string, MarketData>): PriceProvider {
  return async (tickers) => {
    const data = await getMarketData(tickers);
    for (const [t, d] of data) seen.set(t, d);
    return new Map([...data].map(([t, d]) => [t, { price: d.price, currency: d.currency }]));
  };
}

async function loadAccount(a: any): Promise<AccountSummary> {
  const unified: string | undefined = a.meta?.unifiedAccountType;
  const kind = accountKind(unified, a.account_category);
  const totalCurrency: string = a.balance?.total?.currency ?? "CAD";
  const base: AccountSummary = {
    id: a.id,
    label: accountLabel(a.raw_type, kind),
    kind,
    status: "live",
    totalCad: num(a.balance?.total?.amount),
    cashCad: 0,
    holdings: [],
    pastHoldings: [],
    byAssetClass: [],
    warnings: [],
  };
  if (totalCurrency !== "CAD") {
    base.totalCad *= await rateToCad(totalCurrency);
  }
  if (kind === "line_of_credit") return base;

  const client = snaptrade();
  const [positionsRes, balancesRes, activitiesRes] = await Promise.allSettled([
    client.accountInformation.getAllAccountPositions({ accountId: a.id }),
    client.accountInformation.getUserAccountBalance({ accountId: a.id }),
    kind === "cash" ? Promise.resolve([] as Activity[]) : fetchAllActivities(client, a.id),
  ]);
  if (positionsRes.status === "rejected") throw positionsRes.reason;
  if (balancesRes.status === "rejected") throw balancesRes.reason;
  const rawPositions: any = positionsRes.value.data;
  const balances: any[] = (balancesRes.value.data as any[]) ?? [];
  let activities: Activity[] = [];
  if (activitiesRes.status === "fulfilled") activities = activitiesRes.value;
  else base.warnings.push(`Activity history unavailable (${errMsg(activitiesRes.reason)}); purchase details hidden.`);

  // Every currency we might convert: positions, cash, activity amounts, and USD for US listings
  const currencies = new Set<string>(["USD"]);
  for (const p of positionList(rawPositions)) currencies.add(p?.currency ?? "CAD");
  for (const b of balances) currencies.add(b?.currency?.code ?? "CAD");
  for (const act of activities) if (act.currency?.code) currencies.add(act.currency.code);
  const { toCad, warnings: fxWarnings } = await buildToCad(currencies);
  base.warnings.push(...fxWarnings);
  base.cashCad = balances.reduce((s, b) => s + toCad(num(b?.cash), b?.currency?.code ?? "CAD"), 0);

  const histories = buildHistories(activities, toCad);

  const live = normalizePositions(rawPositions, toCad);

  // Only managed portfolios are rebuilt from history: SnapTrade gives them no positions. Every other
  // account uses Wealthsimple's positions as the truth, even when that list is empty (all cash).
  if (kind !== "managed" || live.length > 0) {
    const market = await getMarketData(live.filter((h) => h.marketEligible).map((h) => h.ticker));
    base.holdings = attachMarket(attachDetails(live, histories), market, toCad);
    base.pastHoldings = previouslyHeld(histories, base.holdings);
    base.byAssetClass = groupByAssetClass([
      ...live.map((h) => ({ assetClass: h.assetClass, value: h.valueCad })),
      { assetClass: "cash", value: kind === "cash" ? base.totalCad - live.reduce((s, h) => s + h.valueCad, 0) : base.cashCad },
    ]);
    return base;
  }

  const seen = new Map<string, MarketData>();
  const view = await reconstructAccount(client, a.id, {
    fxProvider,
    priceProvider: process.env.FINNHUB_API_KEY ? marketPriceProvider(seen) : undefined,
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
  base.holdings = attachMarket(attachDetails(kept, histories), seen, toCad);
  base.pastHoldings = previouslyHeld(histories, base.holdings);
  base.byAssetClass = groupByAssetClass(view.byAssetClass);
  return base;
}

export async function getPortfolio(): Promise<Portfolio> {
  const client = snaptrade();
  const [accountsRes, connectionsRes] = await Promise.all([
    client.accountInformation.listUserAccounts(),
    client.connections.listBrokerageAuthorizations(),
  ]);

  const connections: ConnectionStatus[] = ((connectionsRes.data as any[]) ?? []).map((c) => ({
    id: c.id,
    brokerage: c.brokerage?.display_name ?? c.brokerage?.name ?? "Brokerage",
    disabled: Boolean(c.disabled),
  }));

  const all: any[] = (accountsRes.data as any[]) ?? [];
  const visible = all.filter((a) => a.status === "open" && Math.abs(num(a.balance?.total?.amount)) >= 0.01);

  const results = await Promise.allSettled(visible.map(loadAccount));
  const accounts = results.map((r, i): AccountSummary => {
    if (r.status === "fulfilled") return r.value;
    const a = visible[i];
    const kind = accountKind(a.meta?.unifiedAccountType, a.account_category);
    return {
      id: a.id, label: accountLabel(a.raw_type, kind), kind, status: "error",
      totalCad: num(a.balance?.total?.amount), cashCad: 0, holdings: [], pastHoldings: [], byAssetClass: [],
      warnings: [], error: errMsg(r.reason),
    };
  });

  const order = { managed: 0, self_directed: 1, cash: 2, other: 3, line_of_credit: 4 } as const;
  accounts.sort((x, y) => order[x.kind] - order[y.kind] || y.totalCad - x.totalCad);

  return {
    fetchedAt: new Date().toISOString(),
    connections,
    accounts,
    hiddenAccounts: all.length - visible.length,
    marketDataEnabled: Boolean(process.env.FINNHUB_API_KEY),
  };
}
