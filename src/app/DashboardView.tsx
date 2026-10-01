import type { Portfolio } from "@/lib/portfolio";
import { portfolioTotals, type AccountSummary } from "@/lib/positions";
import type { AccountForGoals } from "@/lib/goals";
import PastHoldings from "./PastHoldings";
import ReturnsOverview from "./ReturnsOverview";
import GoalsBoard from "./GoalsBoard";
import HoldingsTable from "./HoldingsTable";
import Shell, { type Tab } from "./Shell";
import { connectWealthsimple, logout } from "./actions";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const cad0 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${cad0.format(Math.abs(v))}`;
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

const STATUS_CHIP: Record<AccountSummary["status"], { text: string; tone: string }> = {
  live: { text: "Live positions", tone: "ok" },
  reconstructed: { text: "Rebuilt from history", tone: "ok" },
  estimated: { text: "Estimated from profile", tone: "" },
  mismatch: { text: "Rebuilt, doesn't match total", tone: "bad" },
  no_reference: { text: "Rebuilt, unverified", tone: "" },
  error: { text: "Failed to load", tone: "bad" },
};

const anchor = (a: AccountSummary) => `acct-${a.id}`;

function MixBar({ account, legend = true }: { account: AccountSummary; legend?: boolean }) {
  const total = account.byAssetClass.reduce((s, r) => s + Math.max(r.value, 0), 0);
  if (total <= 0) return null;
  return (
    <>
      {legend && (
        <div className="mix-legend">
          {account.byAssetClass.map((r) => (
            <span key={r.assetClass}>
              <i className={`dot c-${r.assetClass}`} />
              {r.assetClass} {((r.value / total) * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      )}
      <div className="mix" aria-hidden>
        {account.byAssetClass.map((r) => (
          <div key={r.assetClass} className={`c-${r.assetClass}`} style={{ width: `${(Math.max(r.value, 0) / total) * 100}%` }} />
        ))}
      </div>
    </>
  );
}

function ReturnBadge({ a }: { a: AccountSummary }) {
  const r = a.returns;
  if (!r || a.kind === "line_of_credit") return null;
  if (r.annualReturnPct != null)
    return <span className={`pill ${r.annualReturnPct >= 0 ? "up" : "down"}`}>{pct(r.annualReturnPct)}/yr</span>;
  if (r.totalReturnPct != null) return <span className="pill">{pct(r.totalReturnPct)} so far</span>;
  return null;
}

function AccountCard({ account, marketDataEnabled }: { account: AccountSummary; marketDataEnabled: boolean }) {
  const chip = STATUS_CHIP[account.status];
  const isDebt = account.kind === "line_of_credit";
  return (
    <section className="account card" id={anchor(account)}>
      <div className="account-head">
        <div>
          <h2>{account.label}</h2>
          <div className="badges">
            {!isDebt && <span className={`chip ${chip.tone}`}>{chip.text}</span>}
            {isDebt && <span className="chip bad">Liability</span>}
            {account.cashCad > 0.005 && <span className="chip">Cash {cad.format(account.cashCad)}</span>}
            <ReturnBadge a={account} />
          </div>
        </div>
        <div className={`total ${isDebt ? "loss" : ""}`}>{cad.format(account.totalCad)}</div>
      </div>

      {account.error && <div className="empty loss">Couldn’t load this account: {account.error}</div>}
      {!isDebt && !account.error && <div className="account-mix"><MixBar account={account} /></div>}

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

function Overview({ portfolio }: { portfolio: Portfolio }) {
  const totals = portfolioTotals(portfolio.accounts);
  const c = portfolio.combined;
  const invest = portfolio.accounts.filter((a) => a.kind !== "line_of_credit");
  const debts = portfolio.accounts.filter((a) => a.kind === "line_of_credit");
  return (
    <>
      <section className="hero">
        <div className="hero-main">
          <div className="hero-k">Net worth</div>
          <div className="hero-v">{cad.format(totals.net)}</div>
          {c && c.netDepositsCad > 0 && (
            <div className="hero-sub">
              {signed(c.gainCad)} on {cad0.format(c.netDepositsCad)} put in
              {c.annualReturnPct != null && <> · {pct(c.annualReturnPct)} a year</>}
            </div>
          )}
        </div>
        <div className="hero-stats">
          <div><span>Investments &amp; cash</span><b>{cad.format(totals.assets)}</b></div>
          <div><span>Owed</span><b>{cad.format(totals.liabilities)}</b></div>
          <div><span>Accounts</span><b>{portfolio.accounts.length}</b></div>
        </div>
      </section>

      <div className="sec-head">
        <h2>Accounts</h2>
        <a href="#holdings">See all holdings →</a>
      </div>
      <div className="acct-grid">
        {[...invest, ...debts].map((a) => {
          const isDebt = a.kind === "line_of_credit";
          return (
            <a key={a.id} className={`acct-tile card ${isDebt ? "debt" : ""}`} href={`#holdings:${anchor(a)}`}>
              <div className="at-top">
                <span className="at-name">{a.label}</span>
                <ReturnBadge a={a} />
              </div>
              <div className={`at-val ${isDebt ? "loss" : ""}`}>{cad.format(a.totalCad)}</div>
              {isDebt ? (
                <div className="at-foot">Line of credit</div>
              ) : (
                <>
                  <MixBar account={a} legend={false} />
                  <div className="at-foot">
                    {a.holdings.length > 0 ? `${a.holdings.length} holding${a.holdings.length > 1 ? "s" : ""}` : "Held as cash"}
                    {totals.assets > 0 && ` · ${((a.totalCad / totals.assets) * 100).toFixed(0)}% of assets`}
                  </div>
                </>
              )}
            </a>
          );
        })}
      </div>

      <div className="shortcuts">
        <a className="shortcut card" href="#goals">
          <b>Plan your goals</b>
          <span>Drop milestones on a 3, 5 and 10-year timeline and see which accounts can fund them.</span>
        </a>
        <a className="shortcut card" href="#growth">
          <b>See where growth came from</b>
          <span>Money in versus value today, and each account’s yearly return.</span>
        </a>
      </div>

      <p className="meta">
        Updated {new Date(portfolio.fetchedAt).toLocaleString("en-CA", { timeZone: "America/Halifax" })}
        {portfolio.hiddenAccounts > 0 && ` · ${portfolio.hiddenAccounts} closed or under $1 hidden`} · USD converted at the Bank of
        Canada daily rate
      </p>
    </>
  );
}

export interface DashboardProps {
  portfolio: Portfolio | null;
  loadError: string | null;
  justConnected: boolean;
  signOut: boolean;
}

export default function DashboardView({ portfolio, loadError, justConnected, signOut }: DashboardProps) {
  const disabled = portfolio?.connections.find((c) => c.disabled);
  const hasConnection = (portfolio?.connections.length ?? 0) > 0;
  const ready = Boolean(portfolio && portfolio.accounts.length > 0);

  const actions = (
    <>
      <form action={connectWealthsimple}>
        {disabled && <input type="hidden" name="reconnect" value={disabled.id} />}
        <button className={`btn ${hasConnection && !disabled ? "" : "primary"}`} type="submit">
          {disabled ? "Reconnect" : hasConnection ? "Update connection" : "Connect Wealthsimple"}
        </button>
      </form>
      {signOut && (
        <form action={logout}>
          <button className="btn" type="submit">Sign out</button>
        </form>
      )}
    </>
  );

  const notices = (
    <>
      {justConnected && <div className="banner">Connection updated. New data can take a minute to sync; refresh if anything is missing.</div>}
      {disabled && (
        <div className="banner warn">
          Your {disabled.brokerage} connection is disabled, so the data below may be stale. Use “Reconnect” to fix it.
        </div>
      )}
      {loadError && <div className="banner warn">Couldn’t reach SnapTrade: {loadError}</div>}
      {portfolio && !hasConnection && (
        <div className="banner">
          No brokerage connected yet. Click <strong>Connect Wealthsimple</strong> — you’ll sign in on SnapTrade’s secure page, not here.
        </div>
      )}
    </>
  );

  if (!ready || !portfolio) return <Shell tabs={[{ id: "overview", label: "Overview", content: null }]} actions={actions} notices={notices} />;

  const goalAccounts = portfolio.accounts
    .filter((a) => a.kind !== "line_of_credit" && a.totalCad > 0)
    .map((a): AccountForGoals => ({
      id: a.id,
      label: a.label,
      valueCad: a.totalCad,
      mix: a.byAssetClass.length ? a.byAssetClass : [{ assetClass: "cash", value: a.totalCad }],
      pastReturnPct: a.returns?.annualReturnPct ?? null,
    }));

  const tabs: Tab[] = [
    { id: "overview", label: "Overview", content: <Overview portfolio={portfolio} /> },
    { id: "goals", label: "Goals", content: <GoalsBoard accounts={goalAccounts} /> },
    { id: "growth", label: "Growth", content: <ReturnsOverview portfolio={portfolio} /> },
    {
      id: "holdings",
      label: "Holdings",
      content: portfolio.accounts.map((a) => <AccountCard key={a.id} account={a} marketDataEnabled={portfolio.marketDataEnabled} />),
    },
  ];
  return <Shell tabs={tabs} actions={actions} notices={notices} />;
}
