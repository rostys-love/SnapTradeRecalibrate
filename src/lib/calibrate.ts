// Calibrate: compare the mix you hold with a target rule and suggest the moves that close the gap.
// Pure functions. The app is read-only, so these are suggestions to place yourself, and they are
// illustrations to compare against, not advice.
import type { AssetClass } from "@/reconstruct/core";
import type { Instrument } from "./positions";
import type { TaxType } from "./withdraw";

/** Four buckets where nothing counts twice. Cash, gold and anything unclassified sit outside the rule. */
export type Bucket = "stocks" | "funds" | "bonds" | "play";

export const BUCKETS: Record<Bucket, { label: string; buy: string }> = {
  stocks: { label: "Individual stocks", buy: "individual stocks you choose" },
  funds: { label: "Stock funds", buy: "a broad stock ETF" },
  bonds: { label: "Bonds", buy: "a bond ETF" },
  play: { label: "Play money", buy: "your play-money picks" },
};

export interface CalHolding {
  accountId: string;
  accountLabel: string;
  taxType: TaxType;
  canPick: boolean;          // self-directed: you place the trades. Managed: the brokerage does.
  ticker: string;
  name: string;
  assetClass: AssetClass;
  instrument: Instrument;
  valueCad: number;
  costCad: number | null;
}

/** Key used to tag a holding as play money. */
export const playKey = (h: { ticker: string }) => h.ticker;

export function bucketOf(h: Pick<CalHolding, "assetClass" | "instrument" | "ticker">, play: Set<string>): Bucket | null {
  if (play.has(playKey(h))) return "play";
  if (h.assetClass === "crypto") return "play";
  if (h.assetClass === "bond") return "bonds";
  if (h.assetClass === "equity") return h.instrument === "fund" ? "funds" : "stocks";
  return null; // cash, gold, other
}

export interface TargetGroup {
  id: string;
  label: string;
  buckets: Bucket[];
  pct: number; // of invested money, 0..100
}
export interface Preset {
  id: string;
  name: string;
  blurb: string;
  groups: TargetGroup[];
}

const single = (b: Bucket, pct: number): TargetGroup => ({ id: b, label: BUCKETS[b].label, buckets: [b], pct });

export const PRESETS: Preset[] = [
  {
    id: "rule-30-30-30-10",
    name: "30 / 30 / 30 / 10",
    blurb: "30% individual stocks, 30% stock funds, 30% bonds, 10% play money.",
    groups: [single("stocks", 30), single("funds", 30), single("bonds", 30), single("play", 10)],
  },
  {
    id: "classic-60-40",
    name: "Classic 60 / 40",
    blurb: "60% in stocks of any kind, 40% in bonds. The long-standing middle-of-the-road mix.",
    groups: [
      { id: "stock-side", label: "Stocks of any kind", buckets: ["stocks", "funds", "play"], pct: 60 },
      single("bonds", 40),
    ],
  },
  {
    id: "growth-80-20",
    name: "Growth 80 / 20",
    blurb: "80% in stocks of any kind, 20% in bonds. More growth, bigger swings.",
    groups: [
      { id: "stock-side", label: "Stocks of any kind", buckets: ["stocks", "funds", "play"], pct: 80 },
      single("bonds", 20),
    ],
  },
];

export type CustomTargets = Record<Bucket, number>;
/** Custom sliders: whatever you enter is scaled so the four buckets add up to 100%. */
export function customPreset(t: CustomTargets): Preset {
  const clean = (Object.keys(BUCKETS) as Bucket[]).map((b) => [b, Math.max(0, Number(t[b]) || 0)] as const);
  const total = clean.reduce((s, [, v]) => s + v, 0);
  return {
    id: "custom",
    name: "My own",
    blurb: "Set your own split.",
    groups: clean.map(([b, v]) => single(b, total > 0 ? (v / total) * 100 : 25)),
  };
}

export interface GroupResult extends TargetGroup {
  current: number;      // CAD
  currentPct: number;
  target: number;       // CAD
  diff: number;         // current − target; positive = too much
  status: "over" | "under" | "ok";
  holdings: number;
}

export interface MoveSell {
  ticker: string;
  name: string;
  amount: number;
  gain: number | null;  // realized by this sale, when cost is known
  groupId: string;
}
export interface MoveBuy {
  groupId: string;
  label: string;
  what: string;         // generic description of what to buy
  have: string[];       // tickers already held in this account that fit
  amount: number;
}
export interface AccountMoves {
  accountId: string;
  accountLabel: string;
  taxFree: boolean;     // selling inside a TFSA/RRSP/FHSA isn't taxed
  sells: MoveSell[];
  buys: MoveBuy[];
  taxableGain: number;
}

export interface Calibration {
  invested: number;
  outside: number;          // cash, gold and other holdings left out of the rule
  groups: GroupResult[];
  moves: AccountMoves[];
  shift: number;            // total moved by the suggested trades
  stuck: number;            // excess that can't be traded because it sits in managed accounts
  stuckIn: string[];
  balanced: boolean;
  tolerance: number;
}

/** Gaps smaller than this are treated as on target: 1% of invested money, at least $100. */
const toleranceFor = (invested: number) => Math.max(100, invested * 0.01);

export function calibrate(holdings: CalHolding[], preset: Preset, play: Set<string> = new Set()): Calibration {
  const rows = holdings.filter((h) => h.valueCad > 0.5).map((h) => ({ ...h, bucket: bucketOf(h, play) }));
  const inRule = rows.filter((h) => h.bucket !== null);
  const invested = inRule.reduce((s, h) => s + h.valueCad, 0);
  const outside = rows.reduce((s, h) => s + h.valueCad, 0) - invested;
  const tolerance = toleranceFor(invested);
  const groupOf = (b: Bucket) => preset.groups.find((g) => g.buckets.includes(b));

  const groups: GroupResult[] = preset.groups.map((g) => {
    const mine = inRule.filter((h) => g.buckets.includes(h.bucket!));
    const current = mine.reduce((s, h) => s + h.valueCad, 0);
    const target = (invested * g.pct) / 100;
    const diff = current - target;
    return {
      ...g, current, target, diff, holdings: mine.length,
      currentPct: invested > 0 ? (current / invested) * 100 : 0,
      status: diff > tolerance ? "over" : diff < -tolerance ? "under" : "ok",
    };
  });

  const excess = new Map(groups.filter((g) => g.status === "over").map((g) => [g.id, g.diff]));
  const short = new Map(groups.filter((g) => g.status === "under").map((g) => [g.id, -g.diff]));
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  // Never move more than either side needs
  let budget = Math.min(sum(excess), sum(short));

  // Sell what's over target, where you can place trades: tax-sheltered accounts first, then losers
  // before winners in taxable ones, then the biggest positions.
  const taxFree = (t: TaxType) => t === "tfsa" || t === "rrsp" || t === "fhsa";
  const gainFrac = (h: CalHolding) => (h.costCad != null && h.valueCad > 0 ? (h.valueCad - h.costCad) / h.valueCad : null);
  const candidates = inRule
    .filter((h) => h.canPick && excess.has(groupOf(h.bucket!)?.id ?? ""))
    .sort((a, b) =>
      Number(!taxFree(a.taxType)) - Number(!taxFree(b.taxType)) ||
      (taxFree(a.taxType) ? 0 : (gainFrac(a) ?? 0) - (gainFrac(b) ?? 0)) ||
      b.valueCad - a.valueCad);

  const byAccount = new Map<string, AccountMoves>();
  const movesFor = (h: CalHolding) => {
    let m = byAccount.get(h.accountId);
    if (!m) {
      m = { accountId: h.accountId, accountLabel: h.accountLabel, taxFree: taxFree(h.taxType), sells: [], buys: [], taxableGain: 0 };
      byAccount.set(h.accountId, m);
    }
    return m;
  };
  for (const h of candidates) {
    if (budget <= 0.5) break;
    const g = groupOf(h.bucket!)!;
    const amount = Math.min(h.valueCad, excess.get(g.id) ?? 0, budget);
    if (amount <= 0.5) continue;
    excess.set(g.id, (excess.get(g.id) ?? 0) - amount);
    budget -= amount;
    const frac = gainFrac(h);
    const gain = frac == null ? null : amount * frac;
    const m = movesFor(h);
    m.sells.push({ ticker: h.ticker, name: h.name, amount, gain, groupId: g.id });
    if (!m.taxFree && gain != null) m.taxableGain += gain;
  }

  // Spend each account's proceeds inside that account, on whatever is furthest under target
  for (const m of byAccount.values()) {
    let proceeds = m.sells.reduce((s, x) => s + x.amount, 0);
    const need = sum(short);
    if (need <= 0.5) break;
    const spend = Math.min(proceeds, need);
    for (const g of groups.filter((x) => short.has(x.id))) {
      const want = short.get(g.id) ?? 0;
      const amount = Math.min(want, (spend * want) / need, proceeds);
      if (amount <= 0.5) continue;
      short.set(g.id, want - amount);
      proceeds -= amount;
      const have = inRule
        .filter((h) => h.accountId === m.accountId && g.buckets.includes(h.bucket!))
        .sort((a, b) => b.valueCad - a.valueCad)
        .map((h) => h.ticker);
      m.buys.push({
        groupId: g.id, label: g.label, amount, have: [...new Set(have)].slice(0, 3),
        what: g.buckets.length === 1 ? BUCKETS[g.buckets[0]].buy : "stocks or stock ETFs",
      });
    }
  }

  const moves = [...byAccount.values()].filter((m) => m.sells.length > 0);
  const shift = moves.reduce((s, m) => s + m.sells.reduce((x, y) => x + y.amount, 0), 0);
  const leftOver = Math.max(0, Math.min(sum(excess), sum(short)));
  const stuck = leftOver > 0.5 ? leftOver : 0;
  const stuckIn = stuck
    ? [...new Set(inRule
        .filter((h) => !h.canPick && (excess.get(groupOf(h.bucket!)?.id ?? "") ?? 0) > 0.5)
        .map((h) => h.accountLabel))]
    : [];

  return {
    invested, outside, groups, moves, shift, stuck, stuckIn, tolerance,
    balanced: groups.every((g) => g.status === "ok"),
  };
}
