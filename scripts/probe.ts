// Port Calibrate: SnapTrade + Finnhub probe
// Run: npm run probe
// Needs .env.local with SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY, FINNHUB_API_KEY
// Writes probe-report.json (masked). Add it to .gitignore.

import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";

config({ path: ".env.local" });

const { SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY, FINNHUB_API_KEY } = process.env;
if (!SNAPTRADE_CLIENT_ID || !SNAPTRADE_CONSUMER_KEY) {
  throw new Error("Missing SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY in .env.local");
}

const snaptrade = new Snaptrade({
  auth: SnaptradeAuth.personalApiKey({
    clientId: SNAPTRADE_CLIENT_ID,
    consumerKey: SNAPTRADE_CONSUMER_KEY,
  }),
});

const mask = (s?: string | null) => (s ? `****${s.slice(-4)}` : null);
const errMsg = (e: any) => e?.response?.data?.detail ?? e?.message ?? String(e);

async function probeAccount(account: any) {
  const accountId = account.id;
  const out: any = {
    name: account.name,
    number: mask(account.number),
    institution: account.institution_name,
    rawType: account.raw_type,            // only "TFSA"/"RRSP"/... for Wealthsimple
    unifiedAccountType: account.meta?.unifiedAccountType, // MANAGED_* vs SELF_DIRECTED_* (deprecated field)
    category: account.account_category,   // INVESTMENT / DEPOSIT / LOC
    status: account.status,
    total: account.balance?.total,
    holdingsUnavailable: account.sync_status?.holdings?.holdings_unavailable ?? false,
    lastHoldingsSync: account.sync_status?.holdings?.last_successful_sync,
    firstTransactionDate: account.sync_status?.transactions?.first_transaction_date,
  };

  const [balances, positions, activities] = await Promise.allSettled([
    snaptrade.accountInformation.getUserAccountBalance({ accountId }),
    snaptrade.accountInformation.getAllAccountPositions({ accountId }),
    snaptrade.accountInformation.getAccountActivities({ accountId }),
  ]);

  out.balances = balances.status === "fulfilled"
    ? (balances.value.data as any[]).map((b: any) => ({
        currency: b.currency?.code, cash: b.cash, buyingPower: b.buying_power,
      }))
    : { error: errMsg(balances.reason) };

  // Unified positions schema (verified against a live Wealthsimple account):
  // { results: [{ instrument: { kind, symbol, description, currency, exchange, figi_instrument },
  //   units, price, cost_basis, currency }] }, with numbers returned as strings.
  // Managed Wealthsimple portfolios return an empty list; reconstruct those from activities.
  out.positions = positions.status === "fulfilled"
    ? (((positions.value.data as any)?.results ?? (positions.value.data as any)?.positions ?? []) as any[]).map((p: any) => ({
        ticker: p.instrument?.symbol,
        name: p.instrument?.description,
        kind: p.instrument?.kind,               // stock, etf, other...
        currency: p.currency,
        units: Number(p.units),
        price: Number(p.price),
        costBasisPerUnit: Number(p.cost_basis),
        cashEquivalent: p.cash_equivalent ?? false,
        figi: p.instrument?.figi_instrument?.figi_code,
      }))
    : { error: errMsg(positions.reason) };

  if (activities.status === "fulfilled") {
    const d: any = activities.value.data;
    const items: any[] = Array.isArray(d) ? d : d?.data ?? [];
    const byType: Record<string, number> = {};
    for (const a of items) byType[a.type ?? "UNKNOWN"] = (byType[a.type ?? "UNKNOWN"] ?? 0) + 1;
    const dates = items.map((a) => a.trade_date ?? a.settlement_date).filter(Boolean).sort();
    out.activities = { count: items.length, byType, earliest: dates[0], latest: dates.at(-1) };
  } else {
    out.activities = { error: errMsg(activities.reason) };
  }
  return out;
}

async function probeFinnhub(tickers: string[]) {
  if (!FINNHUB_API_KEY) return { skipped: "FINNHUB_API_KEY not set" };
  const now = Math.floor(Date.now() / 1000);
  const endpoints = (t: string) => ({
    profile: `/stock/profile2?symbol=${t}`,
    quote: `/quote?symbol=${t}`,
    metric: `/stock/metric?symbol=${t}&metric=all`,          // beta, 52w range
    candles: `/stock/candle?symbol=${t}&resolution=D&from=${now - 3 * 365 * 86400}&to=${now}`,
  });
  const results: any = {};
  for (const t of tickers) {
    results[t] = {};
    for (const [name, path] of Object.entries(endpoints(t))) {
      const res = await fetch(`https://finnhub.io/api/v1${path}&token=${FINNHUB_API_KEY}`);
      const body: any = await res.json().catch(() => null);
      const empty = !body || Object.keys(body).length === 0 || body.s === "no_data" || body.c === 0;
      results[t][name] = res.ok ? (empty ? "EMPTY" : "OK") : `HTTP ${res.status}: ${body?.error ?? ""}`;
      if (name === "profile" && res.ok && !empty) results[t].sector = body.finnhubIndustry;
      if (name === "metric" && res.ok && body?.metric) results[t].beta = body.metric.beta;
      await new Promise((r) => setTimeout(r, 1100)); // stay under the free rate limit
    }
  }
  return results;
}

async function main() {
  const conns = await snaptrade.connections.listBrokerageAuthorizations();
  const connections = conns.data.map((c: any) => ({
    brokerage: c.brokerage?.name, disabled: c.disabled, type: c.type,
  }));

  const accounts = (await snaptrade.accountInformation.listUserAccounts()).data;
  const accountResults = [];
  for (const a of accounts) accountResults.push(await probeAccount(a)); // sequential: per-account rate limit

  const tickers = new Set<string>(["AAPL"]); // US control ticker
  for (const a of accountResults) {
    if (Array.isArray(a.positions)) a.positions.slice(0, 3).forEach((p: any) => p.ticker && tickers.add(p.ticker));
  }
  const finnhub = await probeFinnhub([...tickers].slice(0, 6));

  const report = { runAt: new Date().toISOString(), connections, accounts: accountResults, finnhub };
  writeFileSync("probe-report.json", JSON.stringify(report, null, 2));

  console.log(`\nConnections: ${connections.map((c) => `${c.brokerage}${c.disabled ? " (DISABLED)" : ""}`).join(", ")}`);
  for (const a of accountResults) {
    const n = Array.isArray(a.positions) ? a.positions.length : "error";
    console.log(`\n${a.name} [${a.unifiedAccountType ?? a.rawType ?? "no type"}] total=${a.total?.amount ?? "?"} ${a.total?.currency ?? ""}`);
    console.log(`  positions=${n}  holdingsUnavailable=${a.holdingsUnavailable}  activities=${a.activities?.count ?? "error"}`);
  }
  console.log("\nFinnhub:");
  for (const [t, r] of Object.entries<any>(finnhub)) console.log(`  ${t}: ${JSON.stringify(r)}`);
  console.log("\nFull masked report written to probe-report.json");
}

main().catch((e) => { console.error("Probe failed:", errMsg(e)); process.exit(1); });
