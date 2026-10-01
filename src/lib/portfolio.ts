import "server-only";
import { reconstructAccount, finnhubPriceProvider, type PriceProvider } from "@/reconstruct/snaptrade";
import { num } from "@/reconstruct/core";
import { snaptrade } from "./snaptrade";
import { fxProvider, rateToCad } from "./fx";
import {
  AccountSummary, HoldingRow, accountKind, accountLabel, groupByAssetClass, normalizePositions,
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
}

import { friendlyError as errMsg } from "./errors";

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

function priceProvider(): PriceProvider | undefined {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return undefined;
  // Finnhub quotes are in the listing currency: .TO tickers trade in CAD, the rest assumed USD
  return finnhubPriceProvider(key, (t) => (t.endsWith(".TO") || t.endsWith(".V") ? "CAD" : "USD"));
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
    byAssetClass: [],
    warnings: [],
  };
  if (totalCurrency !== "CAD") {
    base.totalCad *= await rateToCad(totalCurrency);
  }
  if (kind === "line_of_credit") return base;

  const client = snaptrade();
  const [positionsRes, balancesRes] = await Promise.all([
    client.accountInformation.getAllAccountPositions({ accountId: a.id }),
    client.accountInformation.getUserAccountBalance({ accountId: a.id }),
  ]);
  const rawPositions: any = positionsRes.data;
  const balances: any[] = (balancesRes.data as any[]) ?? [];

  const currencies = new Set<string>();
  for (const p of rawPositions?.positions ?? []) currencies.add(p?.currency ?? "CAD");
  for (const b of balances) currencies.add(b?.currency?.code ?? "CAD");
  const { toCad, warnings: fxWarnings } = await buildToCad(currencies);
  base.warnings.push(...fxWarnings);
  base.cashCad = balances.reduce((s, b) => s + toCad(num(b?.cash), b?.currency?.code ?? "CAD"), 0);

  const live = normalizePositions(rawPositions, toCad);
  if (live.length > 0 || kind === "cash") {
    base.holdings = live;
    base.byAssetClass = groupByAssetClass([
      ...live.map((h) => ({ assetClass: h.assetClass, value: h.valueCad })),
      { assetClass: "cash", value: kind === "cash" ? base.totalCad - live.reduce((s, h) => s + h.valueCad, 0) : base.cashCad },
    ]);
    return base;
  }

  // Managed portfolios return no positions: rebuild them from activity history
  const view = await reconstructAccount(client, a.id, {
    fxProvider,
    priceProvider: priceProvider(),
    fallbackProfile: "balanced",
  });
  base.status = view.status;
  base.cashCad = view.cash;
  base.warnings.push(...view.warnings);
  base.holdings = view.holdings.map(
    (h): HoldingRow => ({
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
      totalCad: num(a.balance?.total?.amount), cashCad: 0, holdings: [], byAssetClass: [],
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
  };
}
