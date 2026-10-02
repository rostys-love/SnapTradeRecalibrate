// "I need money": what it costs to take an amount out of each account, and the cheapest way to do it.
// Pure functions. Every number here is an estimate built from the assumptions in goals.ts and the
// rates the user sets; none of it is tax advice.
import type { AssetClass } from "@/reconstruct/core";
import {
  ASSUMPTIONS, type AccountForGoals, type Goal, type GoalKind, type GoalStatus, type ReturnBasis,
  accountRate, projectGoal,
} from "./goals";

/** How withdrawals from the account are taxed. "locked" accounts (RESP, LIRA…) are left out. */
export type TaxType = "tfsa" | "rrsp" | "fhsa" | "taxable" | "cash" | "locked";

export interface SellableHolding {
  ticker: string;
  name: string;
  assetClass: AssetClass;
  valueCad: number;
  costCad: number | null;
}

export interface WithdrawAccount extends AccountForGoals {
  taxType: TaxType;
  cashCad: number;
  canPick: boolean; // self-directed: you choose what to sell. Managed: the brokerage sells a slice of everything.
  holdings: SellableHolding[];
}

export interface CreditLine {
  id: string;
  label: string;
  owedCad: number;
}

/** "emergency": a surprise bill, so emergency-fund goals are what the money is for. "other": a purchase with no goal. */
export type Purpose = "emergency" | "other" | { goalId: string };

export interface WithdrawInput {
  amount: number;
  purpose: Purpose;
  repayMonths: number | null; // null = not putting it back
  marginalRate: number;       // 0..1, tax on the next dollar of income
  locRate: number;            // 0..1, yearly interest on the line of credit
  basis: ReturnBasis;
}

export const LONG_HORIZON_YEARS = 10;
export const REPAY_CHOICES: { months: number | null; label: string }[] = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
  { months: null, label: "Not putting it back" },
];

/**
 * Share of the amount lost to a yearly rate. Paid back in equal monthly amounts, on average
 * (M+1)/2M of it is out for M months; never paid back, it compounds for LONG_HORIZON_YEARS.
 */
export function costFactor(rate: number, repayMonths: number | null): number {
  if (repayMonths == null) return Math.pow(1 + rate, LONG_HORIZON_YEARS) - 1;
  return (rate * (repayMonths + 1)) / 24;
}

/** Tax held back at source on RRSP withdrawals (outside Quebec). */
export function withholdingRate(gross: number): number {
  return gross <= 5000 ? 0.1 : gross <= 15000 ? 0.2 : 0.3;
}
/** How much has to leave an RRSP for `net` to arrive after withholding. */
export function grossForNet(net: number): number {
  for (const w of [0.1, 0.2]) {
    const g = net / (1 - w);
    if (withholdingRate(g) <= w) return g;
  }
  return net / 0.7;
}

export interface Sell {
  ticker: string;
  name: string;
  amount: number;
  gain: number | null; // gain (+) or loss (−) realized by this sale, when cost is known
  isCash: boolean;
}

export interface GoalHit {
  goalId: string;
  name: string;
  lostNow: number;          // dollars this goal loses today
  statusBefore: GoalStatus;
  statusAfter: GoalStatus;
  gapBefore: number;
  gapAfter: number;
}

export type Tier = 0 | 1 | 2 | 3;
export const TIER_REASON: Record<Tier, string> = {
  0: "Set aside for exactly this",
  1: "Not promised to any goal",
  2: "Promised to another goal",
  3: "Last resort: taxed, and the room is gone",
};

export interface Take {
  sourceId: string;
  label: string;
  isLoan: boolean;
  taxType: TaxType | "loan";
  net: number;          // what reaches you
  gross: number;        // what leaves the account
  available: number;    // the most this source can give (net)
  growthLost: number;
  taxCost: number;
  withholding: number;
  interest: number;
  cost: number;         // growthLost + taxCost + interest
  ratePct: number;      // yearly rate used for the missed growth (or the loan)
  sells: Sell[];
  notes: string[];
  speed: string;
  tier: Tier;
}

export interface SourceOption extends Take {
  feasible: boolean;    // can cover the whole amount alone
  hits: GoalHit[];
  gapIncrease: number;
}

export interface WithdrawPlan {
  amount: number;
  parts: Take[];
  covered: number;
  shortBy: number;
  growthLost: number;
  taxCost: number;
  interest: number;
  cost: number;
  hits: GoalHit[];
  gapIncrease: number;
  options: SourceOption[];       // every source on its own, cheapest first
  savesVsWorst: { amount: number; label: string } | null;
  excluded: string[];            // locked accounts left out
}

const money = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("en-CA")}`;

interface Ctx {
  input: WithdrawInput;
  purposeKind: GoalKind | null;
  now: Date;
}

const withheldAt = (acc: WithdrawAccount, ctx: Ctx) =>
  acc.taxType === "rrsp" || (acc.taxType === "fhsa" && ctx.purposeKind !== "house");

/** The most an account can put in your hands. */
export function availableNet(acc: WithdrawAccount, ctx: Ctx): number {
  const v = Math.max(acc.valueCad, 0);
  return withheldAt(acc, ctx) ? v * (1 - withholdingRate(v)) : v;
}

function evaluateTake(acc: WithdrawAccount, wantNet: number, ctx: Ctx, tier: Tier): Take {
  const { input } = ctx;
  const M = input.repayMonths;
  const value = Math.max(acc.valueCad, 0);
  const withheld = withheldAt(acc, ctx);
  const gross = Math.min(withheld ? grossForNet(wantNet) : wantNet, value);
  const withholding = withheld ? gross * withholdingRate(gross) : 0;
  const net = gross - withholding;
  const ar = accountRate(acc, input.basis);
  const notes: string[] = [];
  const sells: Sell[] = [];
  let growthLost = 0;
  let realized = 0;
  let costUnknown = false;

  const rateFor = (h: { assetClass: AssetClass; isCash?: boolean }) =>
    h.isCash ? ASSUMPTIONS.cash.rate : ar.source === "past" ? ar.rate : ASSUMPTIONS[h.assetClass].rate;

  if (acc.canPick && acc.holdings.length > 0) {
    const pool = [
      ...(acc.cashCad > 0.5 ? [{ ticker: "Cash", name: "Cash already in the account", assetClass: "cash" as AssetClass, valueCad: acc.cashCad, costCad: acc.cashCad, isCash: true }] : []),
      ...acc.holdings.filter((h) => h.valueCad > 0.5).map((h) => ({ ...h, isCash: false })),
    ].map((h) => {
      const gainFrac = h.costCad != null && h.valueCad > 0 ? (h.valueCad - h.costCad) / h.valueCad : null;
      const tax = acc.taxType === "taxable" && gainFrac != null ? Math.max(0, gainFrac) * 0.5 * input.marginalRate : 0;
      return { ...h, gainFrac, unit: costFactor(rateFor(h), M) + tax };
    });
    // cheapest to give up first; between equals, trim the bigger position
    pool.sort((a, b) => a.unit - b.unit || b.valueCad - a.valueCad);
    let left = gross;
    for (const h of pool) {
      if (left <= 0.005) break;
      const amount = Math.min(left, h.valueCad);
      left -= amount;
      const gain = h.isCash ? 0 : h.gainFrac == null ? null : amount * h.gainFrac;
      if (gain == null) costUnknown = true;
      else realized += gain;
      growthLost += amount * costFactor(rateFor(h), M);
      sells.push({ ticker: h.ticker, name: h.name, amount, gain, isCash: h.isCash });
    }
    if (left > 0.005) growthLost += left * costFactor(ar.rate, M);
  } else {
    growthLost = gross * costFactor(ar.rate, M);
    const known = acc.holdings.filter((h) => h.costCad != null && h.valueCad > 0);
    if (known.length && value > 0) realized = gross * (known.reduce((s, h) => s + (h.valueCad - h.costCad!), 0) / value);
    else if (acc.holdings.length) costUnknown = true;
  }

  let taxCost = 0;
  const year = ctx.now.getUTCFullYear();
  switch (acc.taxType) {
    case "tfsa":
      notes.push(`No tax. The TFSA room comes back on Jan 1, ${year + 1}; put it back sooner only if you have unused room.`);
      break;
    case "rrsp":
    case "fhsa":
      if (withheld) {
        taxCost = Math.max(withholding, input.marginalRate * gross);
        notes.push(`${money(withholding)} is held back for tax, so ${money(gross)} has to leave the account for ${money(net)} to reach you.`);
        notes.push(
          acc.taxType === "rrsp"
            ? "It counts as income this year, and the RRSP room doesn’t come back."
            : "Outside a first-home purchase it’s taxed as income, and the FHSA room doesn’t come back.",
        );
        if (acc.taxType === "rrsp" && ctx.purposeKind === "house")
          notes.push("Buying a first home? The Home Buyers’ Plan may let you take this out tax-free and repay it over time.");
      } else {
        notes.push("Tax-free if this is a qualifying first-home withdrawal.");
      }
      break;
    case "taxable":
      if (realized > 0.5) {
        taxCost = realized * 0.5 * input.marginalRate;
        notes.push(`Selling realizes about ${money(realized)} of capital gains; half of that is taxable.`);
      } else if (realized < -0.5) {
        notes.push(`Selling realizes a ${money(realized)} capital loss, which can offset gains elsewhere.`);
      } else if (costUnknown) {
        notes.push("Purchase cost isn’t known for everything here, so capital gains tax isn’t included.");
      }
      break;
    case "cash":
      notes.push("No selling and no tax on taking it out.");
      break;
  }

  if (acc.taxType !== "taxable") {
    const losers = sells.filter((s) => s.gain != null && s.gain < -0.5);
    if (losers.length) {
      const total = losers.reduce((s, l) => s + l.gain!, 0);
      notes.push(`Selling ${losers.map((l) => l.ticker).join(", ")} now locks in about ${money(total)} of losses.`);
    }
  }
  const hasInvestments = acc.taxType !== "cash" && acc.holdings.length > 0;
  if (hasInvestments && !acc.canPick) notes.push("Wealthsimple sells a slice of every holding for you.");
  if (ar.equityShare > 0.5 && (M ?? 999) <= 24)
    notes.push("Mostly stocks: over a short stretch the real cost could be much higher or lower than this estimate.");

  return {
    sourceId: acc.id, label: acc.label, isLoan: false, taxType: acc.taxType, net, gross, available: availableNet(acc, ctx),
    growthLost, taxCost, withholding, interest: 0, cost: growthLost + taxCost, ratePct: ar.rate * 100, sells, notes,
    speed: hasInvestments && (sells.length === 0 || sells.some((s) => !s.isCash)) ? "A few business days" : "Right away",
    tier,
  };
}

function evaluateLoan(loc: CreditLine, net: number, ctx: Ctx): Take {
  const { locRate, repayMonths } = ctx.input;
  const interest = net * costFactor(locRate, repayMonths);
  const notes = [
    "Your investments stay untouched and keep growing.",
    `Check that you have ${money(net)} of room left on the line${loc.owedCad > 0.5 ? ` (you already owe ${money(loc.owedCad)})` : ""}.`,
    repayMonths == null
      ? `With no plan to repay, the interest keeps building: this is the cost over ${LONG_HORIZON_YEARS} years, and you would still owe the ${money(net)}.`
      : `Borrowing only beats selling if your investments earn more than ${(locRate * 100).toFixed(1)}% over that time, which isn’t guaranteed.`,
  ];
  return {
    sourceId: loc.id, label: loc.label, isLoan: true, taxType: "loan", net, gross: net, available: Infinity,
    growthLost: 0, taxCost: 0, withholding: 0, interest, cost: interest, ratePct: locRate * 100, sells: [], notes,
    speed: "Right away", tier: 2,
  };
}

/** Dollars of each account split into: set aside for this purpose, free, promised to other goals. */
function earmarks(acc: WithdrawAccount, goals: Goal[], purposeIds: Set<string>) {
  const value = Math.max(acc.valueCad, 0);
  let mine = 0, others = 0;
  for (const g of goals) {
    const share = g.sources.find((s) => s.accountId === acc.id)?.share ?? 0;
    if (share <= 0) continue;
    if (purposeIds.has(g.id)) mine += share * value;
    else others += share * value;
  }
  mine = Math.min(mine, value);
  others = Math.min(others, value - mine);
  return { mine, others, free: Math.max(0, value - mine - others) };
}

/** Which goals lose money when `gross` dollars leave each account, and by how much they fall short. */
export function goalImpact(
  takes: Map<string, number>, accounts: WithdrawAccount[], goals: Goal[], purposeIds: Set<string>, basis: ReturnBasis, now: Date,
): { hits: GoalHit[]; gapIncrease: number } {
  const scale = new Map<string, number>();
  for (const acc of accounts) {
    const gross = takes.get(acc.id) ?? 0;
    if (gross <= 0) continue;
    const e = earmarks(acc, goals, purposeIds);
    const hit = Math.min(Math.max(0, gross - e.mine - e.free), e.others);
    if (hit > 0.5 && e.others > 0) scale.set(acc.id, (e.others - hit) / e.others);
  }
  const hits: GoalHit[] = [];
  let gapIncrease = 0;
  if (!scale.size) return { hits, gapIncrease };
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const g of goals) {
    if (purposeIds.has(g.id)) continue;
    let lostNow = 0;
    const sources = g.sources.map((s) => {
      const k = scale.get(s.accountId);
      if (k == null) return s;
      lostNow += s.share * (1 - k) * Math.max(byId.get(s.accountId)?.valueCad ?? 0, 0);
      return { ...s, share: s.share * k };
    });
    if (lostNow <= 0.5) continue;
    const before = projectGoal(g, accounts, basis, now);
    const after = projectGoal({ ...g, sources }, accounts, basis, now);
    gapIncrease += after.gap - before.gap;
    hits.push({
      goalId: g.id, name: g.name, lostNow, statusBefore: before.status, statusAfter: after.status,
      gapBefore: before.gap, gapAfter: after.gap,
    });
  }
  return { hits, gapIncrease };
}

export function purposeGoalIds(purpose: Purpose, goals: Goal[]): Set<string> {
  if (purpose === "emergency") return new Set(goals.filter((g) => g.kind === "emergency").map((g) => g.id));
  if (purpose === "other") return new Set();
  return new Set([purpose.goalId]);
}

/**
 * Ranks every source on its own, then builds the recommended plan:
 *   0. money set aside for this purpose
 *   1. money not promised to any goal, cheapest first
 *   2. money promised to other goals, or borrowing if it will be repaid, whichever is cheaper
 *   3. RRSP / FHSA, because of tax and lost room
 */
export function planWithdrawal(
  input: WithdrawInput, accounts: WithdrawAccount[], goals: Goal[], loc: CreditLine | null, now: Date = new Date(),
): WithdrawPlan {
  const amount = Math.max(0, input.amount || 0);
  const purposeIds = purposeGoalIds(input.purpose, goals);
  const purposeGoal = typeof input.purpose === "object" ? goals.find((g) => purposeIds.has(g.id)) : undefined;
  const ctx: Ctx = { input, purposeKind: purposeGoal?.kind ?? (input.purpose === "emergency" ? "emergency" : null), now };
  const usable = accounts.filter((a) => a.taxType !== "locked" && a.valueCad > 0.5);
  const excluded = accounts.filter((a) => a.taxType === "locked").map((a) => a.label);
  const impact = (takes: Map<string, number>) => goalImpact(takes, usable, goals, purposeIds, input.basis, now);

  const empty: WithdrawPlan = {
    amount, parts: [], covered: 0, shortBy: amount, growthLost: 0, taxCost: 0, interest: 0, cost: 0, hits: [], gapIncrease: 0,
    options: [], savesVsWorst: null, excluded,
  };
  if (amount <= 0) return { ...empty, shortBy: 0 };

  // Every source on its own
  const options: SourceOption[] = usable.map((acc) => {
    const avail = availableNet(acc, ctx);
    const take = evaluateTake(acc, Math.min(amount, avail), ctx, withheldAt(acc, ctx) ? 3 : 1);
    return { ...take, feasible: avail >= amount - 0.005, ...impact(new Map([[acc.id, take.gross]])) };
  });
  if (loc) options.push({ ...evaluateLoan(loc, amount, ctx), feasible: true, hits: [], gapIncrease: 0 });
  // A loan with no plan to repay it isn't a real answer, so it goes last
  const openLoan = (o: SourceOption) => Number(o.isLoan && input.repayMonths == null);
  options.sort((a, b) =>
    openLoan(a) - openLoan(b) || Number(b.feasible) - Number(a.feasible) || a.cost / Math.max(a.net, 1) - b.cost / Math.max(b.net, 1));

  // Tranches for the recommended plan
  interface Tranche { tier: Tier; unit: number; capNet: number; acc?: WithdrawAccount; }
  const tranches: Tranche[] = [];
  for (const acc of usable) {
    const opt = options.find((o) => o.sourceId === acc.id)!;
    const unit = opt.net > 0 ? opt.cost / opt.net : 0;
    const value = Math.max(acc.valueCad, 0);
    const netPerGross = value > 0 ? availableNet(acc, ctx) / value : 1;
    const e = earmarks(acc, goals, purposeIds);
    const lastResort = withheldAt(acc, ctx);
    if (e.mine > 0.5) tranches.push({ tier: 0, unit, capNet: e.mine * netPerGross, acc });
    if (e.free > 0.5) tranches.push({ tier: lastResort ? 3 : 1, unit, capNet: e.free * netPerGross, acc });
    if (e.others > 0.5) tranches.push({ tier: lastResort ? 3 : 2, unit, capNet: e.others * netPerGross, acc });
  }
  // Borrowing never goes ahead of your own spare money; it competes on cost with money promised to goals
  if (loc && input.repayMonths != null) tranches.push({ tier: 2, unit: costFactor(input.locRate, input.repayMonths), capNet: Infinity });
  tranches.sort((a, b) => a.tier - b.tier || a.unit - b.unit);

  const takeNet = new Map<string, { net: number; tier: Tier }>();
  let loanNet = 0;
  let left = amount;
  for (const t of tranches) {
    if (left <= 0.005) break;
    const n = Math.min(left, t.capNet);
    left -= n;
    if (!t.acc) loanNet += n;
    else {
      const cur = takeNet.get(t.acc.id);
      takeNet.set(t.acc.id, { net: (cur?.net ?? 0) + n, tier: cur?.tier ?? t.tier });
    }
  }

  const parts: Take[] = [];
  for (const acc of usable) {
    const t = takeNet.get(acc.id);
    if (t && t.net > 0.005) parts.push(evaluateTake(acc, t.net, ctx, t.tier));
  }
  if (loc && loanNet > 0.005) parts.push(evaluateLoan(loc, loanNet, ctx));
  parts.sort((a, b) => a.tier - b.tier || b.net - a.net);

  const sum = (f: (p: Take) => number) => parts.reduce((s, p) => s + f(p), 0);
  const covered = sum((p) => p.net);
  const cost = sum((p) => p.cost);
  const { hits, gapIncrease } = impact(new Map(parts.filter((p) => !p.isLoan).map((p) => [p.sourceId, p.gross])));

  const worst = options.filter((o) => o.feasible && !openLoan(o)).sort((a, b) => b.cost - a.cost)[0];
  const savesVsWorst = worst && covered >= amount - 0.005 && worst.cost - cost > 1 ? { amount: worst.cost - cost, label: worst.label } : null;

  return {
    amount, parts, covered, shortBy: Math.max(0, amount - covered), growthLost: sum((p) => p.growthLost),
    taxCost: sum((p) => p.taxCost), interest: sum((p) => p.interest), cost, hits, gapIncrease, options, savesVsWorst, excluded,
  };
}
