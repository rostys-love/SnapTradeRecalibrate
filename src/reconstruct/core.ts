// Port Calibrate: holdings reconstruction from SnapTrade activities (pure logic, no network)

export interface ActivitySymbol {
  symbol?: string;
  description?: string | null;
  currency?: { code?: string } | null;
  type?: { code?: string } | null;
  figi_code?: string | null;
  figi_instrument?: { figi_code?: string | null; figi_share_class?: string | null } | null;
}

export interface Activity {
  id?: string;
  type?: string | null;
  symbol?: ActivitySymbol | null;
  units?: number | string | null;
  price?: number | string | null;
  amount?: number | string | null;
  currency?: { code?: string } | null;
  trade_date?: string | null;
  settlement_date?: string | null;
}

export type AssetClass = "equity" | "bond" | "cash" | "gold" | "crypto" | "other";

export interface Holding {
  key: string;              // FIGI share class > FIGI > ticker
  ticker: string;           // most recent ticker seen
  tickersSeen: string[];    // e.g. ["GLOV", "GSWO"] after a rename
  description: string;
  listingCurrency: string;
  assetClass: AssetClass;
  typeCode?: string;        // SnapTrade security type, e.g. "et" (ETF) or "cs" (common stock)
  units: number;
  lastTradePrice: number | null;   // in activity currency (the account currency)
  lastTradeDate: string | null;
}

export interface AggregateResult {
  holdings: Holding[];
  warnings: string[];
  unitTypesSeen: Record<string, number>;
}

const DUST = 1e-6;
const UNIT_TYPES = new Set([
  "BUY", "SELL", "REI", "STOCK_DIVIDEND", "SPLIT", "TRANSFER",
  "OPTIONASSIGNMENT", "OPTIONEXERCISE", "OPTIONEXPIRATION",
]);

export const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

const dateOf = (a: Activity) => a.trade_date ?? a.settlement_date ?? "";

export function holdingKey(s: ActivitySymbol): string {
  return s.figi_instrument?.figi_share_class || s.figi_instrument?.figi_code || s.figi_code || s.symbol || "UNKNOWN";
}

export function classifyAssetClass(description = "", ticker = "", typeCode = ""): AssetClass {
  const text = `${description} ${ticker}`.toLowerCase();
  if (typeCode === "crypto") return "crypto";
  if (/\bbond|aggregate|fixed income|treasury|t-bill|debenture/.test(text)) return "bond";
  if (/gold|bullion|silver|precious metal/.test(text)) return "gold";
  if (/high interest savings|savings account|money market|cash management|\bcash\b/.test(text)) return "cash";
  if (["cs", "et", "oef", "cef", "ad", "ps", "ut"].includes(typeCode) || text.trim()) return "equity";
  return "other";
}

/** Net units per security across the full activity history. */
export function aggregateHoldings(activities: Activity[]): AggregateResult {
  const warnings: string[] = [];
  const unitTypesSeen: Record<string, number> = {};
  const map = new Map<string, Holding>();

  const sorted = [...activities].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));

  for (const a of sorted) {
    let units = num(a.units);
    if (!a.symbol || Math.abs(units) < DUST) continue;

    const type = (a.type ?? "UNKNOWN").toUpperCase();
    unitTypesSeen[type] = (unitTypesSeen[type] ?? 0) + 1;
    if (!UNIT_TYPES.has(type)) {
      warnings.push(`Unrecognized activity type "${type}" changed units of ${a.symbol.symbol}; applied as-is.`);
    }
    // Defensive sign handling: BUY adds, SELL removes, whatever the brokerage sent
    if (type === "BUY" && units < 0) { units = -units; warnings.push(`BUY with negative units for ${a.symbol.symbol}; sign corrected.`); }
    if (type === "SELL" && units > 0) { units = -units; warnings.push(`SELL with positive units for ${a.symbol.symbol}; sign corrected.`); }

    const key = holdingKey(a.symbol);
    const ticker = a.symbol.symbol ?? key;
    const h = map.get(key) ?? {
      key, ticker, tickersSeen: [], description: a.symbol.description ?? "",
      listingCurrency: a.symbol.currency?.code ?? "CAD",
      assetClass: "other" as AssetClass, units: 0, lastTradePrice: null, lastTradeDate: null,
    };
    h.units += units;
    h.ticker = ticker; // latest ticker wins (sorted ascending)
    if (!h.tickersSeen.includes(ticker)) h.tickersSeen.push(ticker);
    if (a.symbol.description) h.description = a.symbol.description;
    const price = num(a.price);
    if (price > 0 && (type === "BUY" || type === "SELL" || type === "REI")) {
      h.lastTradePrice = price;
      h.lastTradeDate = dateOf(a);
    }
    if (a.symbol.type?.code) h.typeCode = a.symbol.type.code;
    h.assetClass = classifyAssetClass(h.description, h.ticker, a.symbol.type?.code ?? "");
    map.set(key, h);
  }

  const holdings = [...map.values()].filter((h) => {
    if (h.units < -DUST) warnings.push(`${h.ticker} nets to negative units (${h.units.toFixed(4)}); history may be incomplete.`);
    return h.units > DUST;
  });
  for (const h of holdings) {
    if (h.tickersSeen.length > 1) warnings.push(`${h.tickersSeen.join(" → ")} merged by FIGI (ticker rename).`);
  }
  return { holdings, warnings, unitTypesSeen };
}

/** Collect every page from an offset-paginated endpoint. */
export async function paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total?: number }>,
  limit = 1000,
  maxPages = 50,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0, offset = 0; page < maxPages; page++, offset += limit) {
    const { items, total } = await fetchPage(offset, limit);
    all.push(...items);
    if (items.length < limit || (total !== undefined && all.length >= total)) return all;
  }
  throw new Error(`Pagination exceeded ${maxPages} pages; refusing to return partial history.`);
}

export interface Quote { price: number; currency: string }
export type PriceSource = "quote" | "last_trade" | "missing";

export interface ValuedHolding extends Holding {
  price: number | null;
  priceSource: PriceSource;
  value: number;            // in base currency
}

export function valueHoldings(
  holdings: Holding[],
  quotes: Map<string, Quote>,
  toBase: (amount: number, fromCurrency: string) => number,
  accountCurrency: string,
): ValuedHolding[] {
  return holdings.map((h) => {
    const q = quotes.get(h.ticker);
    if (q && q.price > 0) {
      return { ...h, price: q.price, priceSource: "quote" as const, value: toBase(h.units * q.price, q.currency) };
    }
    if (h.lastTradePrice) {
      // Activity prices come through in the account's currency
      return { ...h, price: h.lastTradePrice, priceSource: "last_trade" as const, value: toBase(h.units * h.lastTradePrice, accountCurrency) };
    }
    return { ...h, price: null, priceSource: "missing" as const, value: 0 };
  });
}

export type ReconcileStatus = "reconstructed" | "mismatch" | "no_reference";

export function reconcile(holdingsValue: number, cash: number, reportedTotal: number | null, tolerancePct = 3) {
  const reconstructedTotal = holdingsValue + cash;
  if (!reportedTotal || reportedTotal <= 0) {
    return { status: "no_reference" as ReconcileStatus, reconstructedTotal, diffPct: null as number | null };
  }
  const diffPct = ((reconstructedTotal - reportedTotal) / reportedTotal) * 100;
  return {
    status: (Math.abs(diffPct) <= tolerancePct ? "reconstructed" : "mismatch") as ReconcileStatus,
    reconstructedTotal,
    diffPct,
  };
}

/** Rough fallback weights. Label them as estimates in the UI and let the user edit them. */
export type ManagedProfile = "cash" | "conservative" | "balanced" | "growth";
export const PROFILE_WEIGHTS: Record<ManagedProfile, Partial<Record<AssetClass, number>>> = {
  cash: { cash: 1 },
  conservative: { equity: 0.35, bond: 0.6, gold: 0.05 },
  balanced: { equity: 0.55, bond: 0.4, gold: 0.05 },
  growth: { equity: 0.8, bond: 0.15, gold: 0.05 },
};

export function estimateFromProfile(total: number, profile: ManagedProfile) {
  return Object.entries(PROFILE_WEIGHTS[profile]).map(([assetClass, w]) => ({
    assetClass: assetClass as AssetClass,
    value: total * (w ?? 0),
  }));
}
