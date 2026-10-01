// Goals: milestones on a timeline, funded by (shares of) accounts, projected forward.
// Pure functions, no network or browser APIs, so everything here is unit-tested.
import type { AssetClass } from "@/reconstruct/core";

export type GoalKind =
  | "emergency" | "car" | "house" | "baby" | "wedding" | "travel" | "education" | "retirement" | "custom";

export interface GoalSource {
  accountId: string;
  share: number; // 0..1 of that account's value
}

export interface Goal {
  id: string;
  kind: GoalKind;
  name: string;
  target: number;        // CAD
  date: string;          // YYYY-MM-DD
  monthly: number;       // planned monthly contribution, CAD
  sources: GoalSource[];
  monthlyExpenses?: number; // emergency fund only
  months?: number;          // emergency fund only
}

export interface AccountForGoals {
  id: string;
  label: string;
  valueCad: number;
  mix: { assetClass: AssetClass; value: number }[];
  pastReturnPct: number | null; // money-weighted, null if under a year of history
}

export type ReturnBasis = "past" | "mix";

export interface GoalTemplate {
  kind: GoalKind;
  name: string;
  icon: string;
  target: number;
  years: number;
}

export const TEMPLATES: GoalTemplate[] = [
  { kind: "emergency", name: "Emergency fund", icon: "🛟", target: 12000, years: 0.5 },
  { kind: "car", name: "Car", icon: "🚗", target: 15000, years: 2 },
  { kind: "house", name: "House down payment", icon: "🏡", target: 60000, years: 5 },
  { kind: "baby", name: "Baby", icon: "🍼", target: 10000, years: 3 },
  { kind: "wedding", name: "Wedding", icon: "💍", target: 20000, years: 2 },
  { kind: "travel", name: "Trip", icon: "✈️", target: 5000, years: 1 },
  { kind: "education", name: "Education", icon: "🎓", target: 25000, years: 8 },
  { kind: "retirement", name: "Retirement", icon: "🌅", target: 500000, years: 30 },
  { kind: "custom", name: "Something else", icon: "⭐", target: 5000, years: 3 },
];
export const iconFor = (kind: GoalKind) => TEMPLATES.find((t) => t.kind === kind)?.icon ?? "⭐";

/**
 * Long-run illustrative assumptions (nominal, per year). Shown in the UI and meant to be questioned.
 * vol is a rough annual standard deviation used only to draw the low/high range.
 */
export const ASSUMPTIONS: Record<AssetClass, { rate: number; vol: number; label: string }> = {
  cash: { rate: 0.025, vol: 0.005, label: "Cash" },
  bond: { rate: 0.035, vol: 0.05, label: "Bonds" },
  equity: { rate: 0.065, vol: 0.16, label: "Stocks" },
  gold: { rate: 0.03, vol: 0.15, label: "Gold" },
  crypto: { rate: 0.05, vol: 0.6, label: "Crypto" },
  other: { rate: 0.04, vol: 0.1, label: "Other" },
};
const Z90 = 1.2816; // 10th–90th percentile

const DAY_MS = 86_400_000;
export const yearsUntil = (date: string, now: Date) =>
  Math.max(0, (new Date(`${date}T00:00:00Z`).getTime() - now.getTime()) / (365.25 * DAY_MS));

export function addYears(now: Date, years: number): string {
  const d = new Date(now.getTime() + years * 365.25 * DAY_MS);
  return d.toISOString().slice(0, 10);
}

function mixWeights(mix: AccountForGoals["mix"]) {
  const total = mix.reduce((s, m) => s + Math.max(m.value, 0), 0);
  if (total <= 0) return [{ assetClass: "cash" as AssetClass, w: 1 }];
  return mix.filter((m) => m.value > 0).map((m) => ({ assetClass: m.assetClass, w: m.value / total }));
}

/** Expected rate, volatility and where the rate came from, for one account. */
export function accountRate(acc: AccountForGoals, basis: ReturnBasis) {
  const w = mixWeights(acc.mix);
  const mixRate = w.reduce((s, x) => s + x.w * ASSUMPTIONS[x.assetClass].rate, 0);
  const vol = w.reduce((s, x) => s + x.w * ASSUMPTIONS[x.assetClass].vol, 0);
  const equityShare = w.filter((x) => x.assetClass === "equity" || x.assetClass === "crypto").reduce((s, x) => s + x.w, 0);
  const cashShare = w.filter((x) => x.assetClass === "cash").reduce((s, x) => s + x.w, 0);
  const usePast = basis === "past" && acc.pastReturnPct != null;
  return {
    rate: usePast ? acc.pastReturnPct! / 100 : mixRate,
    mixRate,
    vol,
    equityShare,
    cashShare,
    source: usePast ? ("past" as const) : ("mix" as const),
  };
}

/** Future value of a monthly contribution stream. */
export function fvMonthly(monthly: number, rate: number, years: number) {
  const n = Math.round(years * 12);
  if (n <= 0 || monthly <= 0) return 0;
  const i = rate / 12;
  return Math.abs(i) < 1e-9 ? monthly * n : monthly * ((Math.pow(1 + i, n) - 1) / i);
}

export type GoalStatus = "on_track" | "likely" | "short" | "unfunded";

export interface GoalProjection {
  years: number;
  fundedNow: number;
  expected: number;
  low: number;
  high: number;
  blendedRate: number;
  status: GoalStatus;
  gap: number;               // target − expected, if positive
  extraMonthlyNeeded: number; // to close the gap at the blended rate
  progressPct: number;       // funded today ÷ target
  equityShare: number;
  cashShare: number;
  flags: string[];
}

export function effectiveTarget(goal: Goal) {
  if (goal.kind === "emergency" && goal.monthlyExpenses && goal.months) return goal.monthlyExpenses * goal.months;
  return goal.target;
}

export function projectGoal(goal: Goal, accounts: AccountForGoals[], basis: ReturnBasis, now: Date): GoalProjection {
  const target = effectiveTarget(goal);
  const T = yearsUntil(goal.date, now);
  const Tr = Math.max(T, 1 / 12); // range math needs a positive horizon
  const byId = new Map(accounts.map((a) => [a.id, a]));

  let fundedNow = 0, expected = 0, low = 0, high = 0, weightedRate = 0, eq = 0, cash = 0;
  for (const s of goal.sources) {
    const acc = byId.get(s.accountId);
    if (!acc || s.share <= 0) continue;
    const pv = Math.max(acc.valueCad, 0) * Math.min(s.share, 1);
    const r = accountRate(acc, basis);
    const spread = (Z90 * r.vol) / Math.sqrt(Tr);
    fundedNow += pv;
    expected += pv * Math.pow(1 + r.rate, T);
    low += pv * Math.pow(Math.max(1 + r.rate - spread, 0.05), T);
    high += pv * Math.pow(1 + r.rate + spread, T);
    weightedRate += pv * r.rate;
    eq += pv * r.equityShare;
    cash += pv * r.cashShare;
  }
  const blendedRate = fundedNow > 0 ? weightedRate / fundedNow : ASSUMPTIONS.cash.rate;
  const contrib = fvMonthly(goal.monthly, blendedRate, T);
  expected += contrib;
  low += fvMonthly(goal.monthly, Math.min(blendedRate, ASSUMPTIONS.cash.rate), T);
  high += contrib;

  const equityShare = fundedNow > 0 ? eq / fundedNow : 0;
  const cashShare = fundedNow > 0 ? cash / fundedNow : 0;

  let status: GoalStatus;
  if (fundedNow === 0 && goal.monthly === 0) status = "unfunded";
  else if (low >= target) status = "on_track";
  else if (expected >= target) status = "likely";
  else status = "short";

  const gap = Math.max(0, target - expected);
  const factor = fvMonthly(1, blendedRate, T);
  const extraMonthlyNeeded = gap > 0 ? (factor > 0 ? gap / factor : gap) : 0;

  const flags: string[] = [];
  if (fundedNow > 0) {
    if (goal.kind === "emergency" && equityShare > 0.2) {
      flags.push("An emergency fund mostly in stocks can be down exactly when you need it.");
    } else if (T < 3 && equityShare > 0.4) {
      flags.push(`Due in under 3 years but ${Math.round(equityShare * 100)}% stocks: a 20–30% drop near the date would be hard to recover from.`);
    }
    if (T >= 10 && cashShare > 0.6) {
      flags.push(`${Math.round(cashShare * 100)}% cash for a ${Math.round(T)}-year goal: cash rarely beats inflation over that long.`);
    }
  }

  return {
    years: T, fundedNow, expected, low, high, blendedRate, status, gap, extraMonthlyNeeded,
    progressPct: target > 0 ? Math.min(100, (fundedNow / target) * 100) : 0,
    equityShare, cashShare, flags,
  };
}

/** How much of each account is already promised to goals (0..1+). */
export function allocationUsage(goals: Goal[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const g of goals) for (const s of g.sources) used.set(s.accountId, (used.get(s.accountId) ?? 0) + s.share);
  return used;
}

/**
 * Adds (or tops up) an account as a source. With `accounts`, it takes only what the goal still needs
 * (target minus what other sources already cover today), so one tap doesn't use up a whole account.
 * Never exceeds 100% of an account across goals.
 */
export function assignAccount(goals: Goal[], goalId: string, accountId: string, accounts?: AccountForGoals[]): Goal[] {
  const used = allocationUsage(goals);
  const byId = new Map((accounts ?? []).map((a) => [a.id, a]));
  return goals.map((g) => {
    if (g.id !== goalId) return g;
    const existing = g.sources.find((s) => s.accountId === accountId);
    const available = Math.max(0, 1 - (used.get(accountId) ?? 0)) + (existing?.share ?? 0);
    if (available <= 0.0001) return g;
    let share = available;
    const acc = byId.get(accountId);
    if (acc && acc.valueCad > 0) {
      const coveredByOthers = g.sources
        .filter((s) => s.accountId !== accountId)
        .reduce((sum, s) => sum + (byId.get(s.accountId)?.valueCad ?? 0) * s.share, 0);
      const need = Math.max(0, effectiveTarget(g) - coveredByOthers);
      if (need > 0) share = Math.min(available, Math.ceil((need / acc.valueCad) * 100) / 100);
    }
    const sources = existing
      ? g.sources.map((s) => (s.accountId === accountId ? { ...s, share } : s))
      : [...g.sources, { accountId, share }];
    return { ...g, sources };
  });
}

/** Sets one source's share, capped so the account never exceeds 100% across all goals. */
export function setShare(goals: Goal[], goalId: string, accountId: string, share: number): Goal[] {
  const used = allocationUsage(goals);
  return goals.map((g) => {
    if (g.id !== goalId) return g;
    const current = g.sources.find((s) => s.accountId === accountId)?.share ?? 0;
    const cap = Math.max(0, 1 - (used.get(accountId) ?? 0) + current);
    const next = Math.max(0, Math.min(share, cap));
    return {
      ...g,
      sources: next > 0
        ? g.sources.map((s) => (s.accountId === accountId ? { ...s, share: next } : s))
        : g.sources.filter((s) => s.accountId !== accountId),
    };
  });
}

/** Timeline: piecewise-linear so near-term goals get room. Stops at Now, 1, 3, 5, 10, 20+ years. */
export const TIMELINE_STOPS = [0, 1, 3, 5, 10, 20];
export function yearsToPosition(years: number): number {
  const s = TIMELINE_STOPS;
  const y = Math.max(0, Math.min(years, s[s.length - 1]));
  for (let i = 1; i < s.length; i++) {
    if (y <= s[i]) return ((i - 1 + (y - s[i - 1]) / (s[i] - s[i - 1])) / (s.length - 1)) * 100;
  }
  return 100;
}
export function positionToYears(pct: number): number {
  const s = TIMELINE_STOPS;
  const p = (Math.max(0, Math.min(pct, 100)) / 100) * (s.length - 1);
  const i = Math.min(Math.floor(p), s.length - 2);
  return s[i] + (p - i) * (s[i + 1] - s[i]);
}

/** Basic shape check for data read back from storage. */
export function sanitizeGoals(raw: unknown): Goal[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g: any) => g && typeof g.id === "string" && typeof g.date === "string" && Number.isFinite(g.target))
    .map((g: any) => ({
      id: g.id,
      kind: TEMPLATES.some((t) => t.kind === g.kind) ? g.kind : "custom",
      name: String(g.name ?? "Goal").slice(0, 60),
      target: Math.max(0, Number(g.target)),
      date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : new Date().toISOString().slice(0, 10),
      monthly: Math.max(0, Number(g.monthly) || 0),
      sources: Array.isArray(g.sources)
        ? g.sources
            .filter((s: any) => s && typeof s.accountId === "string")
            .map((s: any) => ({ accountId: s.accountId, share: Math.max(0, Math.min(1, Number(s.share) || 0)) }))
        : [],
      ...(g.kind === "emergency" ? { monthlyExpenses: Number(g.monthlyExpenses) || undefined, months: Number(g.months) || undefined } : {}),
    }));
}
