import { requireSession, showSignOut } from "@/lib/auth";
import { getPortfolio, type Portfolio } from "@/lib/portfolio";
import { portfolioTotals, type AccountSummary } from "@/lib/positions";
import PastHoldings from "./PastHoldings";
import ReturnsOverview from "./ReturnsOverview";
import HoldingsTable from "./HoldingsTable";
import { connectWealthsimple, logout } from "./actions";
import { friendlyError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

const STATUS_CHIP: Record<AccountSummary["status"], { text: string; tone: string }> = {
  live: { text: "Live positions", tone: "ok" },
  reconstructed: { text: "Rebuilt from history", tone: "ok" },
  estimated: { text: "Estimated from profile", tone: "" },
  mismatch: { text: "Rebuilt, doesn't match total", tone: "bad" },
  no_reference: { text: "Rebuilt, unverified", tone: "" },
  error: { text: "Failed to load", tone: "bad" },
};


function AssetMix({ account }: { account: AccountSummary }) {
  const total = account.byAssetClass.reduce((s, r) => s + Math.max(r.value, 0), 0);
  if (total <= 0) return null;
  return (
    <>
      <div className="mix-legend">
        {account.byAssetClass.map((r) => (
          <span key={r.assetClass}>
            <i className={`dot c-${r.assetClass}`} />
            {r.assetClass} {((r.value / total) * 100).toFixed(0)}%
          </span>
        ))}
      </div>
      <div className="mix" aria-hidden>
        {account.byAssetClass.map((r) => (
          <div key={r.assetClass} className={`c-${r.assetClass}`} style={{ width: `${(Math.max(r.value, 0) / total) * 100}%` }} />
        ))}
      </div>
    </>
  );
}

function AccountCard({ account, marketDataEnabled }: { account: AccountSummary; marketDataEnabled: boolean }) {
  const chip = STATUS_CHIP[account.status];
  const isDebt = account.kind === "line_of_credit";
  return (
    <section className="account">
      <div className="account-head">
        <div>
          <h2>{account.label}</h2>
          <div className="badges">
            {!isDebt && <span className={`chip ${chip.tone}`}>{chip.text}</span>}
            {isDebt && <span className="chip bad">Liability</span>}
            {account.cashCad > 0.005 && <span className="chip">Cash {cad.format(account.cashCad)}</span>}
          </div>
        </div>
        <div className={`total ${isDebt ? "loss" : ""}`}>{cad.format(account.totalCad)}</div>
      </div>

      {account.error && <div className="empty loss">Couldn’t load this account: {account.error}</div>}
      {!isDebt && !account.error && <AssetMix account={account} />}

      {account.holdings.length > 0 ? (
        <HoldingsTable rows={account.holdings} marketDataEnabled={marketDataEnabled} />
      ) : (
        !isDebt && !account.error && <div className="empty">No individual holdings — this account is held as cash.</div>
      )}

      <PastHoldings items={account.pastHoldings} />

      {account.warnings.length > 0 && (
        <details className="warnings">
          <summary>{account.warnings.length} data note{account.warnings.length > 1 ? "s" : ""}</summary>
          <ul>{account.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession();
  const params = await searchParams;

  let portfolio: Portfolio | null = null;
  let loadError: string | null = null;
  try {
    portfolio = await getPortfolio();
  } catch (e) {
    loadError = friendlyError(e);
  }

  const disabled = portfolio?.connections.find((c) => c.disabled);
  const hasConnection = (portfolio?.connections.length ?? 0) > 0;
  const totals = portfolio ? portfolioTotals(portfolio.accounts) : null;

  return (
    <main className="wrap">
      <header className="topbar">
        <div className="brand">Port Calibrate <span>· holdings</span></div>
        <div className="actions">
          <form action={connectWealthsimple}>
            {disabled && <input type="hidden" name="reconnect" value={disabled.id} />}
            <button className={`btn ${hasConnection && !disabled ? "" : "primary"}`} type="submit">
              {disabled ? "Reconnect Wealthsimple" : hasConnection ? "Add / update connection" : "Connect Wealthsimple"}
            </button>
          </form>
          {showSignOut() && (
            <form action={logout}>
              <button className="btn" type="submit">Sign out</button>
            </form>
          )}
        </div>
      </header>

      {params.connected && <div className="banner">Connection updated. New data can take a minute to sync; refresh if anything is missing.</div>}
      {disabled && (
        <div className="banner warn">
          Your {disabled.brokerage} connection is disabled, so the data below may be stale. Use “Reconnect Wealthsimple” to fix it.
        </div>
      )}
      {loadError && <div className="banner warn">Couldn’t reach SnapTrade: {loadError}</div>}

      {portfolio && !hasConnection && (
        <div className="banner">
          No brokerage connected yet. Click <strong>Connect Wealthsimple</strong> — you’ll sign in on SnapTrade’s secure page, not here.
        </div>
      )}

      {portfolio && totals && portfolio.accounts.length > 0 && (
        <>
          <div className="summary">
            <div className="stat"><div className="k">Investments &amp; cash</div><div className="v">{cad.format(totals.assets)}</div></div>
            <div className="stat"><div className="k">Owed (line of credit)</div><div className="v loss">{cad.format(totals.liabilities)}</div></div>
            <div className="stat"><div className="k">Net</div><div className="v">{cad.format(totals.net)}</div></div>
          </div>
          <p className="meta">
            Fetched {new Date(portfolio.fetchedAt).toLocaleString("en-CA", { timeZone: "America/Halifax" })} ·{" "}
            {portfolio.accounts.length} active account{portfolio.accounts.length > 1 ? "s" : ""}
            {portfolio.hiddenAccounts > 0 && ` · ${portfolio.hiddenAccounts} closed or under $1 hidden`} · USD converted at the Bank of Canada daily rate
          </p>
          <ReturnsOverview portfolio={portfolio} />
          {portfolio.accounts.map((a) => <AccountCard key={a.id} account={a} marketDataEnabled={portfolio.marketDataEnabled} />)}
        </>
      )}
    </main>
  );
}
