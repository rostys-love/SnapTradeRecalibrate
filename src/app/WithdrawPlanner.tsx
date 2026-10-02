"use client";

import { useEffect, useMemo, useState } from "react";
import { type Goal, type ReturnBasis, iconFor, sanitizeGoals } from "@/lib/goals";
import {
  type CreditLine, type GoalHit, type Purpose, type SourceOption, type Take, type WithdrawAccount,
  LONG_HORIZON_YEARS, REPAY_CHOICES, TIER_REASON, planWithdrawal,
} from "@/lib/withdraw";

const GOALS_KEY = "pc_goals_v1";
const BASIS_KEY = "pc_goals_basis_v1";
const SETTINGS_KEY = "pc_withdraw_v1";
const GOALS_EVENT = "pc-goals-changed"; // sent by GoalsBoard when goals are saved

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const QUICK = [500, 2000, 5000, 10000];
const TYPE_LABEL: Record<Take["taxType"], string> = {
  tfsa: "TFSA", rrsp: "RRSP", fhsa: "FHSA", taxable: "Taxable", cash: "Cash", locked: "Locked", loan: "Borrowing",
};

interface Settings {
  amount: number;
  purpose: string;            // "emergency" | "other" | goal id
  repayMonths: number | null;
  marginalPct: number;
  locPct: number;
  useLoc: boolean | null;     // null = follow what the brokerage shows
}
const DEFAULTS: Settings = { amount: 5000, purpose: "emergency", repayMonths: 12, marginalPct: 30, locPct: 5, useLoc: null };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function hitText(h: GoalHit) {
  if (h.gapAfter > h.gapBefore + 1)
    return h.gapBefore > 1
      ? `${h.name}: shortfall grows from ${cad.format(h.gapBefore)} to ${cad.format(h.gapAfter)}`
      : `${h.name}: would fall short by ${cad.format(h.gapAfter)}`;
  return `${h.name}: loses ${cad.format(h.lostNow)} but is still expected to get there`;
}

function Breakdown({ t }: { t: Pick<Take, "growthLost" | "taxCost" | "interest"> }) {
  const items = [
    t.growthLost > 0.5 && `${cad.format(t.growthLost)} missed growth`,
    t.taxCost > 0.5 && `${cad.format(t.taxCost)} tax`,
    t.interest > 0.5 && `${cad.format(t.interest)} interest`,
  ].filter(Boolean);
  return <>{items.length ? items.join(" + ") : "next to nothing"}</>;
}

function Sells({ t }: { t: Take }) {
  const real = t.sells.filter((s) => s.amount > 0.5);
  if (!real.length) return null;
  return (
    <ul className="wd-sells">
      {real.map((s) => (
        <li key={s.ticker}>
          <span>
            {s.isCash ? "Use" : "Sell"} <b>{cad.format(s.amount)}</b> of {s.isCash ? "the cash in this account" : <span className="ticker">{s.ticker}</span>}
            {!s.isCash && <span className="muted"> {s.name}</span>}
          </span>
          {s.gain != null && Math.abs(s.gain) > 0.5 && (
            <span className={s.gain >= 0 ? "gain" : "loss"}>{s.gain >= 0 ? "+" : "−"}{cad.format(Math.abs(s.gain))} {s.gain >= 0 ? "gain" : "loss"}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function OptionCard({ o, maxCost, amount, best, noRepay }: { o: SourceOption; maxCost: number; amount: number; best: boolean; noRepay: boolean }) {
  return (
    <article className={`wd-opt card ${o.feasible && !(o.isLoan && noRepay) ? "" : "off"} ${best ? "best" : ""}`}>
      <div className="wd-opt-top">
        <div>
          <h3>{o.label}</h3>
          <div className="badges">
            {best && <span className="pill up">Cheapest</span>}
            <span className="chip">{TYPE_LABEL[o.taxType]}</span>
            <span className="chip">{o.speed}</span>
            {!o.feasible && <span className="chip bad">Only {cad.format(o.available)} here</span>}
            {o.isLoan && noRepay && <span className="chip bad">Needs a plan to repay</span>}
          </div>
        </div>
        <div className="wd-opt-cost">
          <b>{cad.format(o.cost)}</b>
          <span>cost</span>
        </div>
      </div>
      <div className="wd-bar" aria-hidden>
        <div className="g" style={{ width: `${(o.growthLost / maxCost) * 100}%` }} />
        <div className="t" style={{ width: `${(o.taxCost / maxCost) * 100}%` }} />
        <div className="i" style={{ width: `${(o.interest / maxCost) * 100}%` }} />
      </div>
      <p className="wd-opt-line">
        <Breakdown t={o} />
        <span className="muted"> · {o.isLoan ? "interest at" : "growing at about"} {o.ratePct.toFixed(1)}% a year</span>
        {!o.feasible && <span className="muted"> · covers {cad.format(o.net)} of {cad.format(amount)}</span>}
      </p>
      {o.hits.length > 0 ? (
        <ul className="wd-hits">{o.hits.map((h) => <li key={h.goalId}>{hitText(h)}</li>)}</ul>
      ) : (
        !o.isLoan && <p className="wd-ok">No goals set back</p>
      )}
      <details className="wd-more">
        <summary>Details</summary>
        <Sells t={o} />
        <ul className="wd-notes">{o.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </details>
    </article>
  );
}

export default function WithdrawPlanner({ accounts, loc }: { accounts: WithdrawAccount[]; loc: CreditLine | null }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [basis, setBasis] = useState<ReturnBasis>("mix");
  const [loaded, setLoaded] = useState(false);
  const now = useMemo(() => new Date(), []);

  // Goals live on the Goals page; re-read whenever they change there (or in another window)
  useEffect(() => {
    const known = new Set(accounts.map((a) => a.id));
    const sync = () => {
      setGoals(sanitizeGoals(read(GOALS_KEY, [])).map((g) => ({ ...g, sources: g.sources.filter((x) => known.has(x.accountId)) })));
      setBasis(read<ReturnBasis>(BASIS_KEY, "mix") === "past" ? "past" : "mix");
    };
    sync();
    const saved = read<Partial<Settings>>(SETTINGS_KEY, {});
    setS({
      amount: Number.isFinite(saved.amount) && saved.amount! >= 0 ? Number(saved.amount) : DEFAULTS.amount,
      purpose: typeof saved.purpose === "string" ? saved.purpose : DEFAULTS.purpose,
      repayMonths: REPAY_CHOICES.some((c) => c.months === saved.repayMonths) ? saved.repayMonths! : DEFAULTS.repayMonths,
      marginalPct: Number.isFinite(saved.marginalPct) ? Math.min(60, Math.max(0, Number(saved.marginalPct))) : DEFAULTS.marginalPct,
      locPct: Number.isFinite(saved.locPct) ? Math.min(30, Math.max(0, Number(saved.locPct))) : DEFAULTS.locPct,
      useLoc: typeof saved.useLoc === "boolean" ? saved.useLoc : null,
    });
    setLoaded(true);
    window.addEventListener(GOALS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(GOALS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [accounts]);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* still works for this visit */ }
  }, [s, loaded]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const purposeGoal = goals.find((g) => g.id === s.purpose);
  const purpose: Purpose = s.purpose === "other" ? "other" : purposeGoal ? { goalId: purposeGoal.id } : "emergency";
  const purposeValue = purposeGoal ? purposeGoal.id : s.purpose === "other" ? "other" : "emergency";
  const includeLoc = s.useLoc ?? Boolean(loc);
  const line: CreditLine | null = includeLoc ? loc ?? { id: "loc-manual", label: "Line of credit", owedCad: 0 } : null;

  const plan = useMemo(
    () => planWithdrawal(
      { amount: s.amount, purpose, repayMonths: s.repayMonths, marginalRate: s.marginalPct / 100, locRate: s.locPct / 100, basis },
      accounts, goals, line, now,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, goals, basis, accounts, includeLoc, loc, now],
  );

  const total = accounts.filter((a) => a.taxType !== "locked").reduce((sum, a) => sum + Math.max(a.valueCad, 0), 0);
  const maxCost = Math.max(...plan.options.map((o) => o.cost), 1);
  const cheapest = plan.options.find((o) => o.feasible && !(o.isLoan && s.repayMonths == null))?.sourceId;
  const period = s.repayMonths == null
    ? `over the next ${LONG_HORIZON_YEARS} years`
    : `while it’s out (paid back over ${REPAY_CHOICES.find((c) => c.months === s.repayMonths)!.label})`;
  const title = plan.parts.length === 0
    ? "Nothing to take it from"
    : plan.parts.length === 1
      ? `${plan.parts[0].isLoan ? "Borrow it on your" : "Take it from"} ${plan.parts[0].label}`
      : `Split it across ${plan.parts.length} places`;

  return (
    <div className="wd">
      <section className="card wd-ask">
        <div className="wd-head">
          <h2>Need money?</h2>
          <p className="goals-sub">Say how much and what for. You’ll see what it really costs to take it from each account, and the cheapest way to do it.</p>
        </div>
        <div className="wd-form">
          <div className="field">
            <label htmlFor="wd-amount">How much?</label>
            <div className="wd-amount">
              <span aria-hidden>$</span>
              <input
                id="wd-amount" type="number" inputMode="decimal" min={0} step={100} value={s.amount || ""}
                placeholder="0" onChange={(e) => set("amount", Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="wd-quick">
              {QUICK.map((q) => (
                <button key={q} type="button" className={s.amount === q ? "on" : ""} onClick={() => set("amount", q)}>{cad.format(q)}</button>
              ))}
            </div>
            <small className="muted">{cad.format(total)} across {accounts.length} account{accounts.length === 1 ? "" : "s"}</small>
          </div>
          <div className="field">
            <label htmlFor="wd-purpose">What is it for?</label>
            <select id="wd-purpose" value={purposeValue} onChange={(e) => set("purpose", e.target.value)}>
              <option value="emergency">An emergency or surprise bill</option>
              <option value="other">A purchase that isn’t one of my goals</option>
              {goals.length > 0 && (
                <optgroup label="One of my goals">
                  {goals.map((g) => <option key={g.id} value={g.id}>{iconFor(g.kind)} {g.name}</option>)}
                </optgroup>
              )}
            </select>
            <small className="muted">
              {goals.length === 0
                ? <>Add goals on the <a href="#goals">Goals page</a> to see which ones a withdrawal would set back.</>
                : purposeGoal
                  ? "Money set aside for this goal is used first."
                  : purpose === "emergency"
                    ? "Your emergency fund is used first, if you have one."
                    : "Money promised to your goals is left alone where possible."}
            </small>
          </div>
          <div className="field">
            <span id="wd-repay">When can you put it back?</span>
            <div className="wd-seg" role="group" aria-labelledby="wd-repay">
              {REPAY_CHOICES.map((c) => (
                <button key={String(c.months)} type="button" className={s.repayMonths === c.months ? "on" : ""} aria-pressed={s.repayMonths === c.months} onClick={() => set("repayMonths", c.months)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {s.amount > 0 && (
        <section className="wd-plan" aria-live="polite">
          <div className="wd-plan-head">
            <div>
              <div className="hero-k">Best way to get {cad.format(plan.amount)}</div>
              <h3>{title}</h3>
            </div>
            {plan.parts.length > 0 && (
              <div className="wd-plan-cost">
                <b>{cad.format(plan.cost)}</b>
                <span>estimated cost {period}</span>
              </div>
            )}
          </div>

          {plan.parts.length > 0 && (
            <ol className="wd-parts">
              {plan.parts.map((p) => (
                <li key={p.sourceId}>
                  <div className="wd-part-top">
                    <span className="wd-part-amt">{cad.format(p.net)}</span>
                    <span className="wd-part-from">
                      {p.isLoan ? "borrowed on" : "from"} <b>{p.label}</b>
                      {p.gross - p.net > 0.5 && <span className="muted"> ({cad.format(p.gross)} leaves the account)</span>}
                    </span>
                    <span className="wd-why">{p.isLoan ? "Keeps your investments intact" : TIER_REASON[p.tier]}</span>
                  </div>
                  <div className="wd-part-sub">
                    Cost: <Breakdown t={p} /> · available {p.speed.toLowerCase().replace("a few", "in a few")}
                  </div>
                  <Sells t={p} />
                  {p.notes.length > 0 && (
                    <details className="wd-more">
                      <summary>Good to know</summary>
                      <ul className="wd-notes">{p.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}

          {plan.shortBy > 0.5 && (
            <p className="flag">
              Your accounts cover {cad.format(plan.covered)} of this. You’d still need {cad.format(plan.shortBy)} from somewhere else.
            </p>
          )}
          {plan.parts.length > 0 && (
            <div className="wd-plan-foot">
              {plan.hits.length === 0
                ? <span className="wd-ok">None of your goals are set back</span>
                : <ul className="wd-hits">{plan.hits.map((h) => <li key={h.goalId}>{hitText(h)}</li>)}</ul>}
              {plan.savesVsWorst && (
                <span>Saves about <b>{cad.format(plan.savesVsWorst.amount)}</b> compared with taking it all from {plan.savesVsWorst.label}.</span>
              )}
            </div>
          )}
        </section>
      )}

      {s.amount > 0 && plan.options.length > 1 && (
        <>
          <div className="sec-head">
            <h2>If you took it all from one place</h2>
            <span className="wd-legend"><i className="g" />Missed growth<i className="t" />Tax<i className="i" />Interest</span>
          </div>
          <div className="wd-options">
            {plan.options.map((o) => <OptionCard key={o.sourceId} o={o} maxCost={maxCost} amount={plan.amount} best={o.sourceId === cheapest} noRepay={s.repayMonths == null} />)}
          </div>
        </>
      )}

      <details className="card wd-settings">
        <summary>Assumptions and how this works</summary>
        <div className="ed-grid">
          <label className="field">
            <span>Tax on your next dollar of income: {s.marginalPct}%</span>
            <input type="range" min={0} max={55} step={1} value={s.marginalPct} onChange={(e) => set("marginalPct", Number(e.target.value))} />
            <small>Used for RRSP withdrawals and capital gains. Roughly 20–30% on a modest income, 40–50%+ on a high one.</small>
          </label>
          <label className="field">
            <span>Line of credit interest: {s.locPct.toFixed(2)}%</span>
            <input type="range" min={0} max={15} step={0.05} value={s.locPct} onChange={(e) => set("locPct", Number(e.target.value))} />
            <small>Check your statement for your actual rate.</small>
          </label>
          <label className="field wd-check">
            <span><input type="checkbox" checked={includeLoc} onChange={(e) => set("useLoc", e.target.checked)} /> Include borrowing on a line of credit</span>
            <small>{loc ? `Found one at your brokerage (${cad.format(loc.owedCad)} owed).` : "None found at your brokerage. Tick this if you have one elsewhere."}</small>
          </label>
        </div>
        <ul className="wd-notes">
          <li><b>Missed growth</b> is what the money would likely have earned where it sits, using the “{basis === "past" ? "My past returns" : "Typical returns"}” setting from the Goals page. If you pay it back in equal monthly amounts, on average about half of it is out for the whole period.</li>
          <li><b>Order of the plan:</b> money set aside for this purpose; then money not promised to any goal, cheapest first; then money promised to other goals or borrowing (only if you’ll repay it), whichever costs less; RRSP or FHSA last because of tax and lost room.</li>
          <li><b>Tax</b> is a rough estimate: RRSP withholding of 10%, 20% or 30% depending on the amount (rates outside Quebec), and half of any capital gain taxed at your rate in taxable accounts.</li>
          <li>Self-directed accounts list what to sell: cash first, then the holdings expected to grow least. Managed accounts sell a slice of everything.</li>
          {plan.excluded.length > 0 && <li>Left out because withdrawals are restricted: {plan.excluded.join(", ")}.</li>}
          <li>These are estimates to compare options, not financial or tax advice. Markets can do much better or worse than the averages used here.</li>
        </ul>
      </details>
    </div>
  );
}
