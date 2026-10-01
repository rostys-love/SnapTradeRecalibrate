import type { PastHolding } from "@/lib/positions";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const shortDate = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "short" }) : "—";

export default function PastHoldings({ items }: { items: PastHolding[] }) {
  if (!items.length) return null;
  const total = items.reduce((s, p) => s + p.realizedGainCad, 0);
  return (
    <details className="past">
      <summary>
        Previously held · {items.length} sold ·{" "}
        <span className={total >= 0 ? "gain" : "loss"}>{total >= 0 ? "+" : ""}{cad.format(total)} realized</span>
      </summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Holding</th>
              <th className="col-units">Held</th>
              <th className="col-price">Sold for</th>
              <th>Realized</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.key}>
                <td>
                  <span className="ticker">{p.ticker}</span>
                  <span className="name">{p.name}</span>
                </td>
                <td className="col-units">
                  {shortDate(p.firstBought)} – {shortDate(p.lastSold)}
                  {p.heldFor && <span className="name">{p.heldFor}</span>}
                </td>
                <td className="col-price">{cad.format(p.proceedsCad)}</td>
                <td className={p.realizedGainCad >= 0 ? "gain" : "loss"}>
                  {p.realizedGainCad >= 0 ? "+" : ""}{cad.format(p.realizedGainCad)}
                  {p.realizedPct != null && <span className="name">{p.realizedPct >= 0 ? "+" : ""}{p.realizedPct.toFixed(1)}%</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small past-note">
        From your trade history, using average cost. USD trades are converted at today’s rate, so these are close
        estimates, not tax figures.
      </p>
    </details>
  );
}

