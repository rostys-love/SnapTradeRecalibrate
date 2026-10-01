import "server-only";
import type { MarketData } from "./positions";

// Finnhub market data, cached through Next's fetch cache so page loads stay under the
// free tier's 60 calls/minute. Any ticker Finnhub can't serve is simply left out.

const BASE = "https://finnhub.io/api/v1";
const QUOTE_TTL = 5 * 60;          // seconds
const METRIC_TTL = 24 * 60 * 60;

/** Finnhub quotes in the listing currency: Canadian suffixes trade in CAD, everything else assumed USD. */
export const listingCurrency = (ticker: string) => (/\.(TO|V|NE|CN)$/i.test(ticker) ? "CAD" : "USD");

async function getJson(path: string, ttl: number): Promise<any | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}${path}&token=${key}`, {
      next: { revalidate: ttl },
      signal: AbortSignal.timeout(6000),
    } as RequestInit);
    if (!res.ok) return null; // 403 = not on this plan, 429 = rate limited
    return await res.json();
  } catch {
    return null;
  }
}

const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function fetchOne(ticker: string): Promise<MarketData | null> {
  const sym = encodeURIComponent(ticker);
  const [q, m] = await Promise.all([
    getJson(`/quote?symbol=${sym}`, QUOTE_TTL),
    getJson(`/stock/metric?symbol=${sym}&metric=all`, METRIC_TTL),
  ]);
  const price = finite(q?.c);
  if (!price) return null; // Finnhub returns zeros for symbols it doesn't cover
  return {
    price,
    currency: listingCurrency(ticker),
    change: finite(q?.d),
    changePct: finite(q?.dp),
    prevClose: finite(q?.pc),
    high52: finite(m?.metric?.["52WeekHigh"]),
    low52: finite(m?.metric?.["52WeekLow"]),
    beta: finite(m?.metric?.beta),
  };
}

/** Market data for many tickers with limited concurrency. Missing tickers are absent from the map. */
export async function getMarketData(tickers: string[], concurrency = 4): Promise<Map<string, MarketData>> {
  const out = new Map<string, MarketData>();
  if (!process.env.FINNHUB_API_KEY) return out;
  const queue = [...new Set(tickers)];
  const worker = async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
      const d = await fetchOne(t);
      if (d) out.set(t, d);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
