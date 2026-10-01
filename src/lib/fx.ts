// Exchange rates to CAD from the Bank of Canada Valet API (free, no key, daily).
// The current SnapTrade SDK does not expose its currency-rate endpoints.

const BOC_SERIES: Record<string, string> = { USD: "FXUSDCAD", EUR: "FXEURCAD", GBP: "FXGBPCAD" };

export async function rateToCad(currency: string): Promise<number> {
  if (currency === "CAD") return 1;
  const series = BOC_SERIES[currency];
  if (!series) throw new Error(`No Bank of Canada series for ${currency}`);
  const res = await fetch(`https://www.bankofcanada.ca/valet/observations/${series}/json?recent=1`, {
    next: { revalidate: 6 * 60 * 60 }, // cache 6 hours
  } as RequestInit);
  if (!res.ok) throw new Error(`Bank of Canada rate request failed (${res.status})`);
  const body: any = await res.json();
  const rate = parseFloat(body?.observations?.[0]?.[series]?.v);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Bad ${series} rate in response`);
  return rate;
}

/** Matches the reconstruction module's FxProvider signature. */
export async function fxProvider(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  if (to !== "CAD") throw new Error(`Only CAD conversion is supported (asked ${from}→${to})`);
  return rateToCad(from);
}
