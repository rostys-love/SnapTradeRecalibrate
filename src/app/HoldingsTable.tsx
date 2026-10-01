"use client";
import { Fragment, useState } from "react";
import { rangePosition, type HoldingRow } from "@/lib/positions";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const money = (v: number, currency = "CAD") =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: v !== 0 && Math.abs(v) < 1 ? 4 : 2 }).format(v);
const units = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(4));
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const date = (d: string | null) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "—";
const tone = (v: number | null | undefined) => (v == null ? "muted" : v >= 0 ? "gain" : "loss");

const PRICE_LABEL: Record<HoldingRow["priceSource"], string> = {
  brokerage: "",
  quote: "live quote",
  last_trade: "last trade",
  missing: "no price",
};

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="dstat">
      <div className="dk">{label}</div>
      <div className="dv">{children}</div>
      {hint && <div className="dh">{hint}</div>}
    </div>
  );
}

function RangeBar({ row }: { row: HoldingRow }) {
  const m = row.market!;
  const pos = rangePosition(m);
  if (pos == null) return <span className="muted">—</span>;
  return (
    <div className="range" title={`52-week range ${money(m.low52!, m.currency)} – ${money(m.high52!, m.currency)}`}>
      <div className="range-track">
        <div className="range-marker" style={{ left: `${pos}%` }} />
      </div>
      <div className="range-labels">
        <span>{money(m.low52!, m.currency)}</span>
        <span>{pos.toFixed(0)}% of range</span>
        <span>{money(m.high52!, m.currency)}</span>
      </div>
    </div>
  );
}

function Detail({ row, marketDataEnabled }: { row: HoldingRow; marketDataEnabled: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const d = row.detail;
  const m = row.market;
  const trades = d ? (showAll ? d.trades : d.trades.slice(0, 8)) : [];

  let marketNote: string | null = null;
  if (!m) {
    if (!row.marketEligible) marketNote = "Held by Wealthsimple directly; no public exchange quote.";
    else if (!marketDataEnabled) marketNote = "Add FINNHUB_API_KEY to see live price and 52-week range.";
    else marketNote = "Not covered by your Finnhub plan (common for TSX-listed funds).";
  }

  return (
    <div className="detail">
      <section>
        <h3>Position</h3>
        {d ? (
          <div className="dgrid">
            <Stat label="Units">{units(row.units)}</Stat>
            <Stat label="Held for" hint={d.heldSince ? `since ${date(d.heldSince)}` : undefined}>{d.heldFor ?? "—"}</Stat>
            <Stat label="First bought">{date(d.firstBought)}</Stat>
            <Stat label="Last bought" hint={`${d.buyCount} purchase${d.buyCount === 1 ? "" : "s"}`}>{date(d.lastBought)}</Stat>
            <Stat
              label="Average cost"
              hint={[
                row.costPerUnit != null && row.currency !== "CAD" && d.avgCostCad != null ? `${money(d.avgCostCad)} in CAD` : null,
                d.costSource === "history" ? "computed from your trades" : d.costSource === "brokerage" ? "from Wealthsimple" : null,
              ].filter(Boolean).join(" · ") || undefined}
            >
              {row.costPerUnit != null
                ? `${money(row.costPerUnit, row.currency)} / unit`
                : d.avgCostCad != null ? `${money(d.avgCostCad)} / unit` : "—"}
            </Stat>
            <Stat label="Total cost">{row.costCad != null ? cad.format(row.costCad) : "—"}</Stat>
            <Stat label="Unrealized gain">
              <span className={tone(row.gainPct)}>
                {row.costCad != null ? `${cad.format(row.valueCad - row.costCad)} (${pct(row.gainPct!)})` : "—"}
              </span>
            </Stat>
            {Math.abs(d.realizedGainCad) >= 0.01 && (
              <Stat label="Realized from sales">
                <span className={tone(d.realizedGainCad)}>{cad.format(d.realizedGainCad)}</span>
              </Stat>
            )}
          </div>
        ) : (
          <p className="muted small">No trade history found for this holding.</p>
        )}
        {d && !d.historyComplete && (
          <p className="muted small">
            Trade history doesn’t fully explain the units held (for example, shares transferred in), so cost
            {row.costCad != null ? " comes from Wealthsimple" : " can’t be computed"}.
          </p>
        )}
      </section>

      {d && (d.dividendsTotalCad > 0 || d.lastDividend) && (
        <section>
          <h3>Income</h3>
          <div className="dgrid">
            <Stat label="Dividends, last 12 months">{cad.format(d.dividends12mCad)}</Stat>
            <Stat label="Dividends, all time">{cad.format(d.dividendsTotalCad)}</Stat>
            <Stat label="Yield on cost" hint="last 12 months ÷ cost">
              {d.yieldOnCostPct != null ? `${d.yieldOnCostPct.toFixed(2)}%` : "—"}
            </Stat>
            <Stat label="Last paid">{date(d.lastDividend)}</Stat>
          </div>
        </section>
      )}

      <section>
        <h3>Market</h3>
        {m ? (
          <div className="dgrid">
            <Stat label="Price now" hint="Finnhub, may be delayed">{money(m.price, m.currency)}</Stat>
            <Stat label="Today">
              <span className={tone(m.change)}>
                {m.change != null ? `${money(m.change, m.currency)} (${pct(m.changePct ?? 0)})` : "—"}
              </span>
            </Stat>
            <Stat label="Your position today">
              <span className={tone(row.dayChangeCad)}>{row.dayChangeCad != null ? cad.format(row.dayChangeCad) : "—"}</span>
            </Stat>
            <Stat label="Beta" hint="1.0 moves with the market">{m.beta != null ? m.beta.toFixed(2) : "—"}</Stat>
            <div className="dstat wide">
              <div className="dk">52-week range</div>
              <RangeBar row={row} />
            </div>
          </div>
        ) : (
          <p className="muted small">{marketNote}</p>
        )}
      </section>

      {d && d.trades.length > 0 && (
        <section>
          <h3>Purchase history</h3>
          <div className="table-scroll">
            <table className="trades">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Units</th><th>Price</th><th>Amount (CAD)</th></tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={`${t.date}-${i}`}>
                    <td>{date(t.date)}</td>
                    <td><span className={`chip ${t.units > 0 ? "ok" : "bad"}`}>{t.type === "REI" ? "Reinvest" : t.type.charAt(0) + t.type.slice(1).toLowerCase()}</span></td>
                    <td>{units(Math.abs(t.units))}</td>
                    <td>{t.price ? money(t.price) : "—"}</td>
                    <td>{cad.format(Math.abs(t.amountCad))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.trades.length > 8 && (
            <button className="linkbtn" type="button" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${d.trades.length}${d.tradeCount > d.trades.length ? ` of ${d.tradeCount}` : ""}`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

export default function HoldingsTable({ rows, marketDataEnabled }: { rows: HoldingRow[]; marketDataEnabled: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="table-scroll">
      <table className="holdings">
        <thead>
          <tr>
            <th>Holding</th>
            <th className="col-units">Units</th>
            <th className="col-price">Price</th>
            <th>Value (CAD)</th>
            <th>Gain</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const id = `${h.key}-${h.ticker}`;
            const isOpen = open.has(id);
            return (
              <Fragment key={id}>
                <tr className={`hrow ${isOpen ? "open" : ""}`} onClick={() => toggle(id)}>
                  <td>
                    <button
                      type="button"
                      className="expander"
                      aria-expanded={isOpen}
                      aria-controls={`detail-${id}`}
                      onClick={(e) => { e.stopPropagation(); toggle(id); }}
                    >
                      <span className="chev" aria-hidden>▸</span>
                      <span className="ticker">{h.ticker}</span>
                    </button>
                    <span className="name">{h.name}</span>
                  </td>
                  <td className="col-units">{units(h.units)}</td>
                  <td className="col-price">
                    {h.price != null ? money(h.price, h.currency) : "—"}
                    {h.market?.changePct != null ? (
                      <span className={`name ${tone(h.market.changePct)}`}>{pct(h.market.changePct)} today</span>
                    ) : (
                      PRICE_LABEL[h.priceSource] && <span className="name">{PRICE_LABEL[h.priceSource]}</span>
                    )}
                  </td>
                  <td>{cad.format(h.valueCad)}</td>
                  <td className={tone(h.gainPct)}>
                    {h.gainPct == null ? "—" : `${h.gainPct >= 0 ? "+" : ""}${h.gainPct.toFixed(1)}%`}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="drow" id={`detail-${id}`}>
                    <td colSpan={5}>
                      <Detail row={h} marketDataEnabled={marketDataEnabled} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
