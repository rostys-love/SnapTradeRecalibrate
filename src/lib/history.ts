// Per-holding history from SnapTrade activities: purchase history, holding dates, dividends and
// average cost (the average-cost method used for Canadian ACB). Pure functions, no network.
import { Activity, holdingKey, num } from "@/reconstruct/core";

export interface Trade {
  date: string;          // YYYY-MM-DD
  type: string;          // BUY, SELL, REI, ...
  units: number;         // signed: + bought, - sold
  price: number;
  amountCad: number;     // cash moved, converted to CAD (negative for buys)
}

export interface HoldingHistory {
  key: string;
  ticker: string;
  name: string;
  trades: Trade[];           // newest first
  buyCount: number;
  firstBought: string | null;
  lastBought: string | null;
  heldSince: string | null;  // start of the current, unbroken position
  units: number;             // net units according to history
  avgCostCad: number | null; // per unit
  totalCostCad: number | null;
  realizedGainCad: number;
  sellCount: number;
  lastSold: string | null;
  proceedsCad: number;       // cash received from all sales
  costOfSoldCad: number;     // average cost of the units sold
  boughtCad: number;         // everything ever spent buying
  dividendsTotalCad: number;
  dividends12mCad: number;
  lastDividend: string | null;
}

const DUST = 1e-6;
const BUY_TYPES = new Set(["BUY", "REI"]);
const day = (a: Activity) => (a.trade_date ?? a.settlement_date ?? "").slice(0, 10);

export function buildHistories(
  activities: Activity[],
  toCad: (amount: number, currency: string) => number = (x) => x,
  now: Date = new Date(),
): Map<string, HoldingHistory> {
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const cutoff = yearAgo.toISOString().slice(0, 10);

  const out = new Map<string, HoldingHistory>();
  const get = (a: Activity) => {
    const key = holdingKey(a.symbol!);
    let h = out.get(key);
    if (!h) {
      h = {
        key, ticker: a.symbol!.symbol ?? key, name: a.symbol!.description ?? "", trades: [], buyCount: 0,
        firstBought: null, lastBought: null, heldSince: null, units: 0, avgCostCad: null, totalCostCad: 0,
        realizedGainCad: 0, sellCount: 0, lastSold: null, proceedsCad: 0, costOfSoldCad: 0, boughtCad: 0,
        dividendsTotalCad: 0, dividends12mCad: 0, lastDividend: null,
      };
      out.set(key, h);
    }
    if (a.symbol!.symbol) h.ticker = a.symbol!.symbol; // latest ticker wins (input sorted ascending)
    if (a.symbol!.description) h.name = a.symbol!.description;
    return h;
  };

  const sorted = [...activities]
    .filter((a) => a.symbol)
    .sort((a, b) => day(a).localeCompare(day(b)));

  for (const a of sorted) {
    const type = (a.type ?? "").toUpperCase();
    const date = day(a);
    const currency = a.currency?.code ?? "CAD";
    const amountCad = toCad(num(a.amount), currency);
    let units = num(a.units);

    if (type === "DIVIDEND" || type === "SUBSTITUTE_DIVIDEND") {
      const h = get(a);
      h.dividendsTotalCad += amountCad;
      if (date >= cutoff) h.dividends12mCad += amountCad;
      if (!h.lastDividend || date > h.lastDividend) h.lastDividend = date;
      continue;
    }
    if (Math.abs(units) < DUST) continue;
    if (type === "BUY" && units < 0) units = -units;
    if (type === "SELL" && units > 0) units = -units;

    const h = get(a);
    const price = num(a.price);
    h.trades.push({ date, type, units, price, amountCad });

    if (units > 0) {
      // Buy-like: add to cost. Prefer the cash actually paid (includes fees); fall back to units × price.
      const cost = Math.abs(amountCad) > 0 ? Math.abs(amountCad) : toCad(units * price, currency);
      if (h.units <= DUST) h.heldSince = date; // a new position starts
      h.units += units;
      h.totalCostCad = (h.totalCostCad ?? 0) + cost;
      h.boughtCad += cost;
      if (BUY_TYPES.has(type)) {
        h.buyCount += 1;
        h.firstBought ??= date;
        h.lastBought = date;
      }
    } else {
      // Sell-like: remove cost at the average, book realized gain
      const sold = Math.min(-units, h.units);
      const avg = h.units > DUST ? (h.totalCostCad ?? 0) / h.units : 0;
      const proceeds = Math.abs(amountCad) > 0 ? Math.abs(amountCad) : toCad(sold * price, currency);
      h.realizedGainCad += proceeds - avg * sold;
      h.proceedsCad += proceeds;
      h.costOfSoldCad += avg * sold;
      h.sellCount += 1;
      h.lastSold = date;
      h.totalCostCad = (h.totalCostCad ?? 0) - avg * sold;
      h.units -= -units;
      if (h.units <= DUST) {
        h.units = Math.max(h.units, 0);
        h.totalCostCad = 0;
        h.heldSince = null;
      }
    }
  }

  for (const h of out.values()) {
    h.trades.reverse();
    if (h.units > DUST && h.totalCostCad != null) h.avgCostCad = h.totalCostCad / h.units;
    else h.totalCostCad = null;
  }
  return out;
}

/** History is only trusted for cost if it explains (within 1%) the units actually held. */
export function historyMatches(history: HoldingHistory | undefined, unitsHeld: number): boolean {
  if (!history || unitsHeld <= 0) return false;
  return Math.abs(history.units - unitsHeld) / unitsHeld <= 0.01;
}

/** "2 yr 3 mo", "5 mo", "12 days" */
export function heldFor(since: string | null, now: Date = new Date()): string | null {
  if (!since) return null;
  const start = new Date(`${since}T00:00:00Z`);
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  if (days < 0) return null;
  if (days < 45) return `${days} day${days === 1 ? "" : "s"}`;
  // Calendar months, so exactly two years reads "2 yr" (not 23.98 months)
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (!years) return `${months} mo`;
  return rem ? `${years} yr ${rem} mo` : `${years} yr`;
}
