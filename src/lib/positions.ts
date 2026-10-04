// View models for the holdings page. Pure functions, no network.
import { AssetClass, classifyAssetClass, num } from "@/reconstruct/core";
import { type HoldingHistory, type Trade, heldFor, historyMatches } from "./history";
import type { AccountReturns, Flow } from "./returns";

export type PriceSource = "brokerage" | "quote" | "last_trade" | "missing";

/** Live market data for one listing (Finnhub). Prices are in the listing currency. */
export interface MarketData {
  price: number;
  currency: string;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  high52: number | null;
  low52: number | null;
  beta: number | null;
}

export interface HoldingDetail {
  heldSince: string | null;
  heldFor: string | null;
  firstBought: string | null;
  lastBought: string | null;
  buyCount: number;
  avgCostCad: number | null;
  costSource: "brokerage" | "history" | null;
  realizedGainCad: number;
  dividendsTotalCad: number;
  dividends12mCad: number;
  yieldOnCostPct: number | null;
  lastDividend: string | null;
  trades: Trade[];            // newest first, capped
  tradeCount: number;
  historyComplete: boolean;   // history explains the units held
}

export interface HoldingRow {
  key: string;                 // FIGI share class > FIGI > ticker; joins positions to activity history
  marketEligible: boolean;     // safe to look up on a public exchange feed
  ticker: string;
  name: string;
  assetClass: AssetClass;
  units: number;
  price: number | null;        // in `currency`
  currency: string;
  valueCad: number;
  costCad: number | null;      // null when cost basis is unknown (reconstructed holdings)
  costPerUnit?: number | null; // in `currency` (the same currency as `price`), when known
  gainPct: number | null;
  priceSource: PriceSource;
  detail?: HoldingDetail;
  market?: MarketData;
  dayChangeCad?: number | null;
}

/** Something you held in this account and have sold, from activity history. */
export interface PastHolding {
  key: string;
  ticker: string;
  name: string;
  firstBought: string | null;
  lastSold: string | null;
  heldFor: string | null;      // first purchase to last sale
  boughtCad: number;
  proceedsCad: number;
  realizedGainCad: number;
  realizedPct: number | null;  // realized gain ÷ cost of the units sold
  dividendsTotalCad: number;
  sellCount: number;
}

export type AccountKind = "self_directed" | "managed" | "cash" | "line_of_credit" | "other";
export type AccountStatus = "live" | "reconstructed" | "estimated" | "mismatch" | "no_reference" | "error";

/** How withdrawals are taxed. "locked" covers accounts you can't freely take money from (RESP, LIRA, RRIF…). */
export type AccountTaxType = "tfsa" | "rrsp" | "fhsa" | "taxable" | "cash" | "locked";

export interface AccountSummary {
  id: string;
  label: string;
  kind: AccountKind;
  taxType?: AccountTaxType;
  history?: { activities: number; trades: number }; // how much brokerage history was read for this account
  status: AccountStatus;
  totalCad: number;            // as reported by the brokerage (negative for a line of credit)
  cashCad: number;
  holdings: HoldingRow[];
  pastHoldings: PastHolding[];
  returns?: AccountReturns;
  flows?: Flow[];               // external cash flows, for combined returns
  byAssetClass: { assetClass: AssetClass; value: number }[];
  warnings: string[];
  error?: string;
}

const KIND_FROM_UNIFIED: [RegExp, AccountKind][] = [
  [/LINE_OF_CREDIT/, "line_of_credit"],
  [/^SELF_DIRECTED|^CUSTOM_PORTFOLIO/, "self_directed"],
  [/^MANAGED_SAVE|^HISA|^CASH$/, "cash"],
  [/^MANAGED/, "managed"],
];

export function accountKind(unifiedType: string | undefined, category: string | undefined): AccountKind {
  if (category === "LOC") return "line_of_credit";
  for (const [re, kind] of KIND_FROM_UNIFIED) if (unifiedType && re.test(unifiedType)) return kind;
  if (category === "DEPOSIT") return "cash";
  return "other";
}

/** Registered type wins over the account kind: a TFSA savings account is still a TFSA. */
export function accountTaxType(rawType: string | undefined, unifiedType: string | undefined, kind: AccountKind): AccountTaxType {
  const words = new Set(`${rawType ?? ""} ${unifiedType ?? ""}`.toUpperCase().split(/[^A-Z]+/));
  const has = (...names: string[]) => names.some((n) => words.has(n));
  if (has("RESP", "LIRA", "LRSP", "RRIF", "LRIF", "PRIF", "LIF", "RDSP")) return "locked";
  if (has("TFSA")) return "tfsa";
  if (has("FHSA")) return "fhsa";
  if (has("RRSP", "RSP")) return "rrsp";
  return kind === "cash" ? "cash" : "taxable";
}

const KIND_LABEL: Record<AccountKind, string> = {
  self_directed: "Self-directed",
  managed: "Managed portfolio",
  cash: "Cash",
  line_of_credit: "Line of credit",
  other: "Account",
};

export function accountLabel(rawType: string | undefined, kind: AccountKind): string {
  const type = rawType && !["PERSONAL", "CASH", "MSB"].includes(rawType) ? rawType : "";
  return [type, KIND_LABEL[kind]].filter(Boolean).join(" · ");
}

/** Position rows from getAllAccountPositions. The SDK returns `results`; the MCP connector renames it `positions`. */
export function positionList(raw: unknown): any[] {
  const r: any = raw;
  return r?.results ?? r?.positions ?? (Array.isArray(r) ? r : []);
}

/** Normalize the unified positions response (numbers arrive as strings). */
export function normalizePositions(
  raw: unknown,
  toCad: (amount: number, currency: string) => number,
): HoldingRow[] {
  const list = positionList(raw);
  return list
    .map((p): HoldingRow | null => {
      const inst = p?.instrument ?? {};
      const units = num(p?.units);
      if (!units) return null;
      const currency: string = p?.currency ?? inst.currency ?? "CAD";
      const price = p?.price != null ? num(p.price) : null;
      const costPerUnit = p?.cost_basis != null ? num(p.cost_basis) : null;
      const kind: string = inst.kind ?? "";
      const typeCode = kind === "etf" ? "et" : kind === "crypto" ? "crypto" : kind === "stock" ? "cs" : "";
      const assetClass: AssetClass = p?.cash_equivalent
        ? "cash"
        : classifyAssetClass(inst.description ?? "", inst.symbol ?? "", typeCode);
      const valueCad = price != null ? toCad(units * price, currency) : 0;
      const costCad = costPerUnit ? toCad(units * costPerUnit, currency) : null;
      return {
        key: inst.figi_instrument?.figi_share_class || inst.figi_instrument?.figi_code || inst.symbol || "?",
        // Wealthsimple-internal assets (e.g. physical gold, kind "other") share tickers with unrelated listings
        marketEligible: ["stock", "etf", "adr"].includes(kind),
        ticker: inst.symbol ?? "?",
        name: inst.description ?? "",
        assetClass,
        units,
        price,
        currency,
        valueCad,
        costCad,
        costPerUnit: costPerUnit || null,
        gainPct: costCad ? ((valueCad - costCad) / costCad) * 100 : null,
        priceSource: price != null ? "brokerage" : "missing",
      };
    })
    .filter((r): r is HoldingRow => r !== null)
    .sort((a, b) => b.valueCad - a.valueCad);
}

export function groupByAssetClass(rows: { assetClass: AssetClass; value: number }[]) {
  const m = new Map<AssetClass, number>();
  for (const r of rows) if (r.value) m.set(r.assetClass, (m.get(r.assetClass) ?? 0) + r.value);
  return [...m.entries()].map(([assetClass, value]) => ({ assetClass, value })).sort((a, b) => b.value - a.value);
}

export function portfolioTotals(accounts: AccountSummary[]) {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    if (a.kind === "line_of_credit") liabilities += Math.abs(a.totalCad);
    else assets += a.totalCad;
  }
  return { assets, liabilities, net: assets - liabilities };
}

const MAX_TRADES = 50;

/**
 * Adds purchase history, dates held, dividends and (where the brokerage has none) cost basis
 * computed from history. Cost from history is only used when it explains the units held.
 */
export function attachDetails(rows: HoldingRow[], histories: Map<string, HoldingHistory>, now = new Date()): HoldingRow[] {
  const byTicker = new Map([...histories.values()].map((h) => [h.ticker, h]));
  return rows.map((row) => {
    const h = histories.get(row.key) ?? byTicker.get(row.ticker);
    if (!h) return row;
    const complete = historyMatches(h, row.units);
    let { costCad, gainPct } = row;
    let costSource: HoldingDetail["costSource"] = costCad != null ? "brokerage" : null;
    if (costCad == null && complete && h.totalCostCad) {
      costCad = h.totalCostCad;
      gainPct = ((row.valueCad - costCad) / costCad) * 100;
      costSource = "history";
    }
    const avgCostCad = costCad != null && row.units > 0 ? costCad / row.units : null;
    const costPerUnit = row.costPerUnit ?? (costSource === "history" && row.currency === "CAD" && avgCostCad != null ? avgCostCad : null);
    return {
      ...row,
      costCad,
      costPerUnit,
      gainPct,
      detail: {
        heldSince: h.heldSince,
        heldFor: heldFor(h.heldSince, now),
        firstBought: h.firstBought,
        lastBought: h.lastBought,
        buyCount: h.buyCount,
        avgCostCad,
        costSource,
        realizedGainCad: h.realizedGainCad,
        dividendsTotalCad: h.dividendsTotalCad,
        dividends12mCad: h.dividends12mCad,
        yieldOnCostPct: costCad ? (h.dividends12mCad / costCad) * 100 : null,
        lastDividend: h.lastDividend,
        trades: h.trades.slice(0, MAX_TRADES),
        tradeCount: h.trades.length,
        historyComplete: complete,
      },
    };
  });
}

/** Attaches live market data and today's change in CAD. */
export function attachMarket(
  rows: HoldingRow[],
  market: Map<string, MarketData>,
  toCad: (amount: number, currency: string) => number,
): HoldingRow[] {
  return rows.map((row) => {
    const m = row.marketEligible ? market.get(row.ticker) : undefined;
    if (!m) return row;
    return { ...row, market: m, dayChangeCad: m.change != null ? toCad(m.change * row.units, m.currency) : null };
  });
}

/** Where today's price sits in the 52-week range, 0..100, or null. */
export function rangePosition(m: MarketData | undefined): number | null {
  if (!m || m.high52 == null || m.low52 == null || m.high52 <= m.low52) return null;
  return Math.min(100, Math.max(0, ((m.price - m.low52) / (m.high52 - m.low52)) * 100));
}

/**
 * Holdings with at least one sale that are no longer held. Current holdings are matched by key and by
 * ticker, so a position you still own is never listed here even if its history is incomplete.
 */
export function previouslyHeld(histories: Map<string, HoldingHistory>, current: HoldingRow[]): PastHolding[] {
  const keys = new Set(current.map((r) => r.key));
  const tickers = new Set(current.map((r) => r.ticker));
  return [...histories.values()]
    .filter((h) => h.sellCount > 0 && !keys.has(h.key) && !tickers.has(h.ticker))
    .map((h) => ({
      key: h.key,
      ticker: h.ticker,
      name: h.name,
      firstBought: h.firstBought,
      lastSold: h.lastSold,
      heldFor: h.firstBought && h.lastSold ? heldFor(h.firstBought, new Date(`${h.lastSold}T23:59:59Z`)) : null,
      boughtCad: h.boughtCad,
      proceedsCad: h.proceedsCad,
      realizedGainCad: h.realizedGainCad,
      realizedPct: h.costOfSoldCad > 0 ? (h.realizedGainCad / h.costOfSoldCad) * 100 : null,
      dividendsTotalCad: h.dividendsTotalCad,
      sellCount: h.sellCount,
    }))
    .sort((a, b) => (b.lastSold ?? "").localeCompare(a.lastSold ?? ""));
}

/** Splits rebuilt holdings into real ones and rounding leftovers worth less than `minCad`. */
export function splitResiduals(rows: HoldingRow[], minCad = 1) {
  const kept: HoldingRow[] = [];
  const residual: HoldingRow[] = [];
  for (const r of rows) (r.priceSource !== "missing" && Math.abs(r.valueCad) < minCad ? residual : kept).push(r);
  return { kept, residual };
}

/** Describes a portfolio by what it holds: Cash, Conservative, Balanced or Growth. */
export function mixLabel(byAssetClass: { assetClass: AssetClass; value: number }[]): string | null {
  const total = byAssetClass.reduce((s, r) => s + Math.max(r.value, 0), 0);
  if (total <= 0) return null;
  const share = (c: AssetClass) => byAssetClass.filter((r) => r.assetClass === c).reduce((s, r) => s + r.value, 0) / total;
  const cash = share("cash");
  const equity = share("equity") + share("crypto");
  if (cash >= 0.9) return "Cash";
  if (equity >= 0.75) return "Growth";
  if (equity >= 0.45) return "Balanced";
  return "Conservative";
}

/** Makes account labels distinguishable: managed accounts get their mix, remaining duplicates get ···1234. */
export function disambiguateLabels(accounts: { label: string; kind: AccountKind; byAssetClass: { assetClass: AssetClass; value: number }[]; numberSuffix?: string }[]) {
  for (const a of accounts) {
    if (a.kind !== "managed") continue;
    const mix = mixLabel(a.byAssetClass);
    if (mix) a.label = a.label.replace("Managed portfolio", `Managed · ${mix}`);
  }
  const counts = new Map<string, number>();
  for (const a of accounts) counts.set(a.label, (counts.get(a.label) ?? 0) + 1);
  for (const a of accounts) {
    if ((counts.get(a.label) ?? 0) > 1 && a.numberSuffix) a.label = `${a.label} ···${a.numberSuffix}`;
  }
}
