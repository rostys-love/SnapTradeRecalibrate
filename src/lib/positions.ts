// View models for the holdings page. Pure functions, no network.
import { AssetClass, classifyAssetClass, num } from "@/reconstruct/core";

export type PriceSource = "brokerage" | "quote" | "last_trade" | "missing";

export interface HoldingRow {
  ticker: string;
  name: string;
  assetClass: AssetClass;
  units: number;
  price: number | null;        // in `currency`
  currency: string;
  valueCad: number;
  costCad: number | null;      // null when cost basis is unknown (reconstructed holdings)
  gainPct: number | null;
  priceSource: PriceSource;
}

export type AccountKind = "self_directed" | "managed" | "cash" | "line_of_credit" | "other";
export type AccountStatus = "live" | "reconstructed" | "estimated" | "mismatch" | "no_reference" | "error";

export interface AccountSummary {
  id: string;
  label: string;
  kind: AccountKind;
  status: AccountStatus;
  totalCad: number;            // as reported by the brokerage (negative for a line of credit)
  cashCad: number;
  holdings: HoldingRow[];
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

/** Normalize the unified positions response ({ positions: [...] }, numbers as strings). */
export function normalizePositions(
  raw: unknown,
  toCad: (amount: number, currency: string) => number,
): HoldingRow[] {
  const list: any[] = (raw as any)?.positions ?? (Array.isArray(raw) ? raw : []);
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
        ticker: inst.symbol ?? "?",
        name: inst.description ?? "",
        assetClass,
        units,
        price,
        currency,
        valueCad,
        costCad,
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
