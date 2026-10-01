import type { AccountSummary } from "@/lib/positions";
import type { Portfolio } from "@/lib/portfolio";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const cad2 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${cad.format(Math.abs(v))}`;
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const monthYear = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "short" }) : "—";

function AnnualCell({ a }: { a: AccountSummary }) {
  const r = a.returns!;
  if (r.annualReturnPct != null) {
    return <span className={r.annualReturnPct >= 0 ? "gain" : "loss"}>{pct(r.annualReturnPct)}/yr</span>;
  }
  if (r.totalReturnPct != null && r.years < 1) {
    return (
      <span className="muted" title="Annual rates are misleading over less than a year">
        {pct(r.totalReturnPct)} <span className="name">under 1 yr</span>
      </span>
    );
  }
  return <span className="muted">—</span>;
}

export default function ReturnsOverview({ portfolio }: { portfolio: Portfolio }) {
  const invest = portfolio.accounts.filter((a) => a.kind !== "line_of_credit" && a.returns && a.returns.netDepositsCad !== 0);
  if (!invest.length) return null;
  const loc = portfolio.accounts.filter((a) => a.kind === "line_of_credit" && a.returns);
  const maxAbsGain = Math.max(...invest.map((a) => Math.abs(a.returns!.gainCad)), 1);
  const positiveGain = invest.reduce((s, a) => s + Math.max(a.returns!.gainCad, 0), 0);
  const fees = invest.reduce((s, a) => s + a.returns!.feesCad, 0);
  const locInterest = loc.reduce((s, a) => s + Math.max(-a.returns!.interestCad, 0) + a.returns!.feesCad, 0);
  const c = portfolio.combined;
  const notes = invest.flatMap((a) => a.returns!.warnings.map((w) => `${a.label}: ${w}`));

  return (
    <section className="returns">
      <div className="returns-head">
        <h2>Where your growth came from</h2>
        {c && (
          <div className="returns-total">
            <span>Put in <strong>{cad.format(c.netDepositsCad)}</strong></span>
            <span>Worth <strong>{cad.format(c.valueCad)}</strong></span>
            <span>
              Gained <strong className={c.gainCad >= 0 ? "gain" : "loss"}>{signed(c.gainCad)}</strong>
            </span>
            {c.annualReturnPct != null && (
              <span>
                Overall <strong className={c.annualReturnPct >= 0 ? "gain" : "loss"}>{pct(c.annualReturnPct)}/yr</strong>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="table-scroll">
        <table className="returns-table">
          <thead>
            <tr>
              <th>Account</th>
              <th className="col-units">Money in</th>
              <th className="col-price">Value</th>
              <th>Gain</th>
              <th>Return</th>
            </tr>
          </thead>
          <tbody>
            {invest
              .slice()
              .sort((x, y) => y.returns!.gainCad - x.returns!.gainCad)
              .map((a) => {
                const r = a.returns!;
                const share = positiveGain > 0 && r.gainCad > 0 ? (r.gainCad / positiveGain) * 100 : null;
                return (
                  <tr key={a.id}>
                    <td>
                      <span className="acct">{a.label}</span>
                      <span className="name">since {monthYear(r.since)}</span>
                      <div className="share" aria-hidden>
                        <div
                          className={`share-bar ${r.gainCad >= 0 ? "pos" : "neg"}`}
                          style={{ width: `${(Math.abs(r.gainCad) / maxAbsGain) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="col-units">{cad.format(r.netDepositsCad)}</td>
                    <td className="col-price">{cad.format(r.valueCad)}</td>
                    <td className={r.gainCad >= 0 ? "gain" : "loss"}>
                      {signed(r.gainCad)}
                      {share != null && <span className="name">{share.toFixed(0)}% of growth</span>}
                    </td>
                    <td>
                      <AnnualCell a={a} />
                      {r.interestCad > 0.5 && <span className="name">{cad.format(r.interestCad)} interest</span>}
                      {r.dividendsCad > 0.5 && <span className="name">{cad.format(r.dividendsCad)} dividends</span>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {(fees > 0.5 || locInterest > 0.5) && (
        <p className="costs">
          Costs along the way:
          {fees > 0.5 && <> <strong>{cad2.format(fees)}</strong> in fees</>}
          {fees > 0.5 && locInterest > 0.5 && " and"}
          {locInterest > 0.5 && <> <strong className="loss">{cad2.format(locInterest)}</strong> in line-of-credit interest</>}.
        </p>
      )}

      <details className="method">
        <summary>How this is calculated{notes.length ? ` · ${notes.length} note${notes.length > 1 ? "s" : ""}` : ""}</summary>
        <ul>
          <li><strong>Money in</strong> is deposits and transfers in, minus withdrawals and transfers out, from your activity history.</li>
          <li><strong>Gain</strong> is today’s value minus money in, so it includes interest, dividends and price changes, after fees.</li>
          <li>
            <strong>Return</strong> is a money-weighted annual rate: a deposit made last month counts for one month, not
            the whole period. It’s shown once an account has a year of history.
          </li>
          {notes.map((n, i) => <li key={i} className="note">{n}</li>)}
        </ul>
      </details>
    </section>
  );
}
