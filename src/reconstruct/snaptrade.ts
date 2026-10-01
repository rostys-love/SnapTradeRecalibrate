// Port Calibrate: SnapTrade I/O for reconstruction. Server-side only (uses the Personal API key).
import type { PersonalApiKeyAuth, Snaptrade } from "snaptrade-typescript-sdk";

/** The Personal-key client: account calls take no userId/userSecret. */
export type PersonalClient = Snaptrade<PersonalApiKeyAuth>;
import {
  Activity, AssetClass, ManagedProfile, Quote, ValuedHolding,
  aggregateHoldings, estimateFromProfile, num, paginate, reconcile, valueHoldings,
} from "./core";

export type PriceProvider = (tickers: string[]) => Promise<Map<string, Quote>>;
export type FxProvider = (from: string, to: string) => Promise<number>;

export interface ReconstructOptions {
  priceProvider?: PriceProvider;   // live quotes; falls back to last trade price
  fxProvider?: FxProvider;         // required if any holding is priced in another currency
  tolerancePct?: number;           // default 3
  fallbackProfile?: ManagedProfile;
  /** Data the caller already fetched, to avoid repeat calls (personal keys allow ~10 requests/min per account). */
  prefetched?: {
    activities?: Activity[];
    balances?: any[];
    total?: { amount?: number | string | null; currency?: string | null } | null;
  };
}

export interface AccountView {
  accountId: string;
  status: "reconstructed" | "estimated" | "mismatch" | "no_reference";
  currency: string;
  reportedTotal: number | null;
  reconstructedTotal: number;
  diffPct: number | null;
  cash: number;
  holdings: ValuedHolding[];
  byAssetClass: { assetClass: AssetClass; value: number }[];
  activitiesRead: number;
  warnings: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries on 429, honouring Retry-After. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.response?.status ?? e?.status;
      if (status !== 429 || attempt >= tries) throw e;
      const retryAfter = Number(e?.response?.headers?.["retry-after"]) || 2 ** attempt;
      await sleep((retryAfter + Math.random()) * 1000);
    }
  }
}

export async function fetchAllActivities(snaptrade: PersonalClient, accountId: string): Promise<Activity[]> {
  return paginate<Activity>(async (offset, limit) => {
    const res = await withRetry(() =>
      snaptrade.accountInformation.getAccountActivities({ accountId, offset, limit }),
    );
    const body: any = res.data;
    if (Array.isArray(body)) return { items: body };
    return { items: body?.data ?? [], total: body?.pagination?.total };
  });
}

export async function reconstructAccount(
  snaptrade: PersonalClient,
  accountId: string,
  opts: ReconstructOptions = {},
): Promise<AccountView> {
  const tolerancePct = opts.tolerancePct ?? 3;

  const pre = opts.prefetched ?? {};
  const [total, balancesData, activities] = await Promise.all([
    pre.total !== undefined
      ? Promise.resolve(pre.total as any)
      : withRetry(() => snaptrade.accountInformation.getUserAccountDetails({ accountId })).then(
          (d) => (d.data as any)?.balance?.total,
        ),
    pre.balances ?? withRetry(() => snaptrade.accountInformation.getUserAccountBalance({ accountId })).then((b) => b.data as any[]),
    pre.activities ?? fetchAllActivities(snaptrade, accountId),
  ]);

  const currency: string = total?.currency ?? "CAD";
  const reportedTotal = total?.amount != null ? num(total.amount) : null;

  // FX rates are fetched once per currency and cached for this run
  const rates = new Map<string, number>([[currency, 1]]);
  const warnings: string[] = [];
  const neededCurrencies = new Set<string>();

  const { holdings, warnings: aggWarnings } = aggregateHoldings(activities);
  warnings.push(...aggWarnings);

  const quotes = opts.priceProvider
    ? await opts.priceProvider(holdings.map((h) => h.ticker)).catch((e) => {
        warnings.push(`Price provider failed (${e?.message ?? e}); using last trade prices.`);
        return new Map<string, Quote>();
      })
    : new Map<string, Quote>();

  for (const q of quotes.values()) if (q.currency !== currency) neededCurrencies.add(q.currency);
  const cashRows: any[] = balancesData ?? [];
  for (const b of cashRows) {
    const c = b?.currency?.code;
    if (c && c !== currency) neededCurrencies.add(c);
  }
  for (const c of neededCurrencies) {
    if (!opts.fxProvider) {
      warnings.push(`No FX provider for ${c}→${currency}; those amounts are excluded.`);
      rates.set(c, 0);
      continue;
    }
    rates.set(c, await opts.fxProvider(c, currency));
  }
  const toBase = (amount: number, from: string) => amount * (rates.get(from) ?? 0);

  const cash = cashRows.reduce((sum, b) => sum + toBase(num(b?.cash), b?.currency?.code ?? currency), 0);
  const valued = valueHoldings(holdings, quotes, toBase, currency);

  const stale = valued.filter((h) => h.priceSource === "last_trade");
  if (stale.length) warnings.push(`Priced from last trade (may be stale): ${stale.map((h) => h.ticker).join(", ")}.`);
  const missing = valued.filter((h) => h.priceSource === "missing");
  if (missing.length) warnings.push(`No price available: ${missing.map((h) => h.ticker).join(", ")}.`);

  const holdingsValue = valued.reduce((s, h) => s + h.value, 0);
  const rec = reconcile(holdingsValue, cash, reportedTotal, tolerancePct);

  const groupByClass = (rows: { assetClass: AssetClass; value: number }[]) => {
    const m = new Map<AssetClass, number>();
    for (const r of rows) m.set(r.assetClass, (m.get(r.assetClass) ?? 0) + r.value);
    return [...m.entries()].map(([assetClass, value]) => ({ assetClass, value }));
  };

  if (rec.status === "mismatch" && opts.fallbackProfile && reportedTotal) {
    warnings.push(
      `Reconstruction off by ${rec.diffPct!.toFixed(1)}% (tolerance ${tolerancePct}%); ` +
        `using the "${opts.fallbackProfile}" profile estimate instead.`,
    );
    return {
      accountId, status: "estimated", currency, reportedTotal,
      reconstructedTotal: rec.reconstructedTotal, diffPct: rec.diffPct, cash,
      holdings: valued, byAssetClass: estimateFromProfile(reportedTotal, opts.fallbackProfile),
      activitiesRead: activities.length, warnings,
    };
  }

  return {
    accountId, status: rec.status, currency, reportedTotal,
    reconstructedTotal: rec.reconstructedTotal, diffPct: rec.diffPct, cash,
    holdings: valued.sort((a, b) => b.value - a.value),
    byAssetClass: groupByClass([...valued, { assetClass: "cash", value: cash }]),
    activitiesRead: activities.length, warnings,
  };
}

/** Optional Finnhub quotes. Tickers Finnhub can't serve simply come back missing. */
export function finnhubPriceProvider(apiKey: string, currencyOf: (ticker: string) => string): PriceProvider {
  return async (tickers) => {
    const out = new Map<string, Quote>();
    for (const t of tickers) {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${apiKey}`);
      if (res.ok) {
        const q: any = await res.json();
        if (q?.c > 0) out.set(t, { price: q.c, currency: currencyOf(t) });
      }
      await sleep(1100); // stay under the free-tier rate limit
    }
    return out;
  };
}
