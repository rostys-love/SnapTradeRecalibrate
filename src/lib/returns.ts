// Account-level returns from SnapTrade activities: money in vs value now, income, fees, and a
// money-weighted annual return (XIRR). Pure functions, no network.
import { type Activity, num } from "@/reconstruct/core";

/** Cash crossing the account boundary. Positive amount = money into the account. */
const FLOW_TYPES = new Set([
  "CONTRIBUTION", "DEPOSIT", "WITHDRAWAL",
  "INTERNAL_CASH_TRANSFER_IN", "INTERNAL_CASH_TRANSFER_OUT", "TRANSFER",
]);

export interface Flow {
  date: string;     // YYYY-MM-DD
  amountCad: number; // + into the account, - out of it
}

export interface AccountReturns {
  depositsCad: number;
  withdrawalsCad: number;
  netDepositsCad: number;
  valueCad: number;
  gainCad: number;
  gainPctOfDeposits: number | null;
  annualReturnPct: number | null;   // XIRR, only when history spans at least a year
  totalReturnPct: number | null;    // simple gain ÷ net deposits, always shown
  since: string | null;             // first money-in date
  years: number;
  dividendsCad: number;
  interestCad: number;              // positive = earned, negative = paid
  feesCad: number;                  // shown as a positive cost
  warnings: string[];
}

const day = (a: Activity) => (a.trade_date ?? a.settlement_date ?? "").slice(0, 10);
const YEAR_MS = 365.25 * 86_400_000;
const yearsBetween = (a: string, b: Date) => (b.getTime() - new Date(`${a}T00:00:00Z`).getTime()) / YEAR_MS;

/** External cash flows. Transfers that move securities (units) rather than cash are skipped and flagged. */
export function extractFlows(activities: Activity[], toCad: (amt: number, cur: string) => number) {
  const flows: Flow[] = [];
  let inKindTransfers = 0;
  for (const a of activities) {
    const type = (a.type ?? "").toUpperCase();
    if (!FLOW_TYPES.has(type)) continue;
    const amount = toCad(num(a.amount), a.currency?.code ?? "CAD");
    if (a.symbol && num(a.units) !== 0) {
      inKindTransfers += 1; // securities moved in or out; their value isn't in `amount`
      continue;
    }
    if (amount === 0) continue;
    flows.push({ date: day(a), amountCad: amount });
  }
  flows.sort((x, y) => x.date.localeCompare(y.date));
  return { flows, inKindTransfers };
}

/**
 * Money-weighted annual return. Investor view: deposits are money out of pocket (negative),
 * withdrawals and today's value are money back (positive). Returns a fraction (0.07 = 7%) or null.
 */
export function xirr(cashflows: { date: string; amount: number }[], now: Date): number | null {
  if (cashflows.length < 2) return null;
  const hasNeg = cashflows.some((c) => c.amount < 0);
  const hasPos = cashflows.some((c) => c.amount > 0);
  if (!hasNeg || !hasPos) return null;
  const t = cashflows.map((c) => yearsBetween(c.date, now) * -1); // years from now (negative = past)
  const npv = (r: number) => cashflows.reduce((s, c, i) => s + c.amount / Math.pow(1 + r, t[i]), 0);

  // Bisection: robust, and NPV is monotonic in r for normal deposit-then-value patterns
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || hi - lo < 1e-10) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export function accountReturns(
  activities: Activity[],
  valueCad: number,
  toCad: (amt: number, cur: string) => number,
  now: Date = new Date(),
): AccountReturns {
  const warnings: string[] = [];
  const { flows, inKindTransfers } = extractFlows(activities, toCad);

  let dividendsCad = 0;
  let interestCad = 0;
  let feesCad = 0;
  for (const a of activities) {
    const type = (a.type ?? "").toUpperCase();
    const amt = toCad(num(a.amount), a.currency?.code ?? "CAD");
    if (type === "DIVIDEND" || type === "SUBSTITUTE_DIVIDEND") dividendsCad += amt;
    else if (type === "INTEREST") interestCad += amt;
    else if (type === "FEE" || type === "TAX") feesCad += -amt;
  }

  const depositsCad = flows.filter((f) => f.amountCad > 0).reduce((s, f) => s + f.amountCad, 0);
  const withdrawalsCad = -flows.filter((f) => f.amountCad < 0).reduce((s, f) => s + f.amountCad, 0);
  const netDepositsCad = depositsCad - withdrawalsCad;
  const gainCad = valueCad - netDepositsCad;
  const since = flows.find((f) => f.amountCad > 0)?.date ?? null;
  const years = since ? Math.max(0, yearsBetween(since, now)) : 0;

  if (inKindTransfers) {
    warnings.push(
      `${inKindTransfers} transfer${inKindTransfers > 1 ? "s" : ""} of securities aren't counted as money in, so the gain may be overstated.`,
    );
  }
  // If the first recorded activity isn't money coming in, history likely starts after the account opened
  const sorted = [...activities].filter((a) => day(a)).sort((x, y) => day(x).localeCompare(day(y)));
  const first = sorted[0];
  if (first && !(FLOW_TYPES.has((first.type ?? "").toUpperCase()) && num(first.amount) > 0)) {
    warnings.push("History seems to start after this account was opened; earlier deposits may be missing.");
  }
  if (netDepositsCad <= 0 && valueCad > 0) {
    warnings.push("Recorded withdrawals exceed deposits; returns can't be measured reliably.");
  }

  const reliable = netDepositsCad > 0;
  let annualReturnPct: number | null = null;
  if (reliable && years >= 1) {
    const cf = flows.map((f) => ({ date: f.date, amount: -f.amountCad }));
    cf.push({ date: now.toISOString().slice(0, 10), amount: valueCad });
    const r = xirr(cf, now);
    annualReturnPct = r == null ? null : r * 100;
  }

  return {
    depositsCad,
    withdrawalsCad,
    netDepositsCad,
    valueCad,
    gainCad,
    gainPctOfDeposits: reliable ? (gainCad / netDepositsCad) * 100 : null,
    annualReturnPct,
    totalReturnPct: reliable ? (gainCad / netDepositsCad) * 100 : null,
    since,
    years,
    dividendsCad,
    interestCad,
    feesCad,
    warnings,
  };
}

/** Combined returns across accounts: transfers between your own accounts cancel out. */
export function combinedReturns(perAccount: { flows: Flow[]; valueCad: number }[], now: Date = new Date()) {
  const flows = perAccount.flatMap((a) => a.flows);
  const valueCad = perAccount.reduce((s, a) => s + a.valueCad, 0);
  const net = flows.reduce((s, f) => s + f.amountCad, 0);
  const since = flows.filter((f) => f.amountCad > 0).map((f) => f.date).sort()[0] ?? null;
  const years = since ? yearsBetween(since, now) : 0;
  let annualReturnPct: number | null = null;
  if (net > 0 && years >= 1) {
    const cf = flows.map((f) => ({ date: f.date, amount: -f.amountCad }));
    cf.push({ date: now.toISOString().slice(0, 10), amount: valueCad });
    const r = xirr(cf, now);
    annualReturnPct = r == null ? null : r * 100;
  }
  return { netDepositsCad: net, valueCad, gainCad: valueCad - net, annualReturnPct, since };
}
