"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSUMPTIONS, TEMPLATES, accountRate, addYears, allocationUsage, assignAccount, effectiveTarget, iconFor,
  positionToYears, projectGoal, sanitizeGoals, setShare, yearsToPosition, yearsUntil,
  type AccountForGoals, type Goal, type GoalKind, type GoalProjection, type ReturnBasis,
} from "@/lib/goals";

// The demo keeps its goals under its own prefix, so sample goals never mix with real ones in one browser
const storeKey = (ns: string) => `${ns}_goals_v1`;
const basisKey = (ns: string) => `${ns}_goals_basis_v1`;
const neverStored = (key: string) => {
  try { return window.localStorage.getItem(key) === null; } catch { return true; }
};
const CARD_W = 168; // px, used to stack overlapping cards into rows
const CARD_H = 84;

const cad0 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const monthYear = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
const uid = () => Math.random().toString(36).slice(2, 10);

const STATUS: Record<GoalProjection["status"], { text: string; tone: string }> = {
  on_track: { text: "On track", tone: "ok" },
  likely: { text: "Likely", tone: "mid" },
  short: { text: "Short", tone: "bad" },
  unfunded: { text: "Not funded yet", tone: "none" },
};

type Drag =
  | { kind: "card"; goalId: string; startX: number; startPct: number; moved: boolean }
  | { kind: "template"; template: GoalKind; x: number; y: number; moved: boolean; startX: number; startY: number }
  | { kind: "account"; accountId: string; x: number; y: number; moved: boolean; startX: number; startY: number };

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event("pc-goals-changed")); // the Need money page re-reads goals
  } catch {
    /* storage unavailable: goals still work for this visit */
  }
}

export default function GoalsBoard({ accounts, storageNs = "pc", seedGoals }: { accounts: AccountForGoals[]; storageNs?: string; seedGoals?: Goal[] }) {
  const STORE_KEY = storeKey(storageNs);
  const BASIS_KEY = basisKey(storageNs);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [basis, setBasis] = useState<ReturnBasis>("mix");
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [laneWidth, setLaneWidth] = useState(800);
  const laneRef = useRef<HTMLDivElement>(null);
  const now = useMemo(() => new Date(), []);

  // Load after mount so server and client render the same first frame
  useEffect(() => {
    const known = new Set(accounts.map((a) => a.id));
    const gs = sanitizeGoals(seedGoals && neverStored(STORE_KEY) ? seedGoals : readStore(STORE_KEY, [])).map((g) => ({
      ...g,
      sources: g.sources.filter((s) => known.has(s.accountId)),
    }));
    setGoals(gs);
    setBasis(readStore<ReturnBasis>(BASIS_KEY, "mix") === "past" ? "past" : "mix");
    setLoaded(true);
  }, [accounts, seedGoals, STORE_KEY, BASIS_KEY]);
  useEffect(() => { if (loaded) writeStore(STORE_KEY, goals); }, [goals, loaded, STORE_KEY]);
  useEffect(() => { if (loaded) writeStore(BASIS_KEY, basis); }, [basis, loaded, BASIS_KEY]);

  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLaneWidth(e.contentRect.width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projections = useMemo(
    () => new Map(goals.map((g) => [g.id, projectGoal(g, accounts, basis, now)])),
    [goals, accounts, basis, now],
  );
  const usage = useMemo(() => allocationUsage(goals), [goals]);
  const sel = goals.find((g) => g.id === selected) ?? null;

  const update = (id: string, patch: Partial<Goal>) => setGoals((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const addGoal = useCallback((kind: GoalKind, years?: number) => {
    const t = TEMPLATES.find((x) => x.kind === kind)!;
    const g: Goal = {
      id: uid(), kind, name: t.name, target: t.target, monthly: 0, sources: [],
      date: firstOfMonth(addYears(now, years ?? t.years)),
      ...(kind === "emergency" ? { monthlyExpenses: 3000, months: 4 } : {}),
    };
    setGoals((gs) => [...gs, g]);
    setSelected(g.id);
  }, [now]);

  // Card layout: position by date, then stack overlapping cards into rows
  const layout = useMemo(() => {
    const cardPct = (CARD_W / Math.max(laneWidth, 1)) * 100;
    const items = goals
      .map((g) => ({ g, pct: yearsToPosition(yearsUntil(g.date, now)) }))
      .sort((a, b) => a.pct - b.pct);
    const rowEnds: number[] = [];
    return items.map(({ g, pct }) => {
      const left = Math.min(pct, Math.max(0, 100 - cardPct));
      let row = rowEnds.findIndex((end) => end <= left);
      if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
      rowEnds[row] = left + cardPct + 0.8;
      return { g, pct, left, row };
    });
  }, [goals, laneWidth, now]);
  const rows = Math.max(1, ...layout.map((l) => l.row + 1));

  // ---- pointer-driven drag (works for mouse, pen and touch) ----
  const lanePct = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 100;
  };
  const overLane = (x: number, y: number) => {
    const r = laneRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top - 40 && y <= r.bottom + 20;
  };

  // Live drag state lives in a ref so pointer handlers never run side effects inside state updaters
  const dragRef = useRef<Drag | null>(null);
  const live = useRef({ laneWidth, selected, accounts });
  live.current = { laneWidth, selected, accounts };
  const setDragBoth = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "card") {
        const dx = e.clientX - d.startX;
        const moved = d.moved || Math.abs(dx) > 4;
        if (moved) {
          const pct = d.startPct + (dx / Math.max(live.current.laneWidth, 1)) * 100;
          const date = firstOfMonth(addYears(now, positionToYears(pct)));
          setGoals((gs) => gs.map((g) => (g.id === d.goalId && g.date !== date ? { ...g, date } : g)));
        }
        if (moved !== d.moved) setDragBoth({ ...d, moved });
        return;
      }
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6;
      setDragBoth({ ...d, x: e.clientX, y: e.clientY, moved });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      setDragBoth(null);
      if (!d) return;
      if (d.kind === "card" && !d.moved) setSelected(d.goalId);
      if (d.kind === "template") {
        if (d.moved && overLane(e.clientX, e.clientY)) addGoal(d.template, positionToYears(lanePct(e.clientX)));
        else if (!d.moved) addGoal(d.template);
      }
      if (d.kind === "account") {
        const target = d.moved
          ? (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-goal-id]") as HTMLElement | null)?.dataset.goalId
          : live.current.selected ?? undefined;
        if (target) {
          setGoals((gs) => assignAccount(gs, target, d.accountId, live.current.accounts));
          setSelected(target);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // Listeners are attached once per drag; everything they read is in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag === null]);

  type GhostStart = { kind: "template"; template: GoalKind } | { kind: "account"; accountId: string };
  const startGhost = (e: React.PointerEvent, d: GhostStart) => {
    e.preventDefault();
    const pos = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
    setDragBoth(d.kind === "template" ? { ...d, ...pos } : { ...d, ...pos });
  };

  const freeShare = (id: string) => Math.max(0, 1 - (usage.get(id) ?? 0));
  const dragAccount = drag?.kind === "account" ? accounts.find((a) => a.id === drag.accountId) : null;

  return (
    <section className="goals" aria-label="Goals">
      <div className="goals-head">
        <div>
          <h2>Your goals</h2>
          <p className="goals-sub">
            Add a goal, drag it to when you need the money, then drop accounts on it to fund it.
          </p>
        </div>
        <div className="basis" role="radiogroup" aria-label="Project growth using">
          <button role="radio" aria-checked={basis === "mix"} className={basis === "mix" ? "on" : ""} onClick={() => setBasis("mix")}>
            Typical returns
          </button>
          <button role="radio" aria-checked={basis === "past"} className={basis === "past" ? "on" : ""} onClick={() => setBasis("past")}>
            My past returns
          </button>
        </div>
      </div>

      <div className="palette" aria-label="Add a goal">
        {TEMPLATES.map((t) => (
          <button
            key={t.kind}
            className="tmpl"
            onPointerDown={(e) => startGhost(e, { kind: "template", template: t.kind })}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addGoal(t.kind); } }}
            aria-label={`Add ${t.name}`}
          >
            <span aria-hidden>{t.icon}</span> {t.name}
          </button>
        ))}
      </div>

      <div className="lane-scroll">
        <div className="lane" ref={laneRef} style={{ height: rows * (CARD_H + 10) + 46 }}>
          <div className="axis" aria-hidden>
            {[0, 1, 3, 5, 10, 20].map((y) => (
              <div key={y} className="tick" style={{ left: `${yearsToPosition(y)}%` }}>
                <span>{y === 0 ? "Now" : y === 20 ? "20 yr+" : `${y} yr`}</span>
              </div>
            ))}
          </div>

          {loaded && goals.length === 0 && (
            <div className="lane-empty">Pick a goal above, or drag one onto this line.</div>
          )}

          {layout.map(({ g, pct, left, row }) => {
            const p = projections.get(g.id)!;
            const st = STATUS[p.status];
            const isSel = g.id === selected;
            const isDrop = drag?.kind === "account" && drag.moved;
            return (
              <div key={g.id}>
                <div className="pin" style={{ left: `${pct}%`, height: row * (CARD_H + 10) + 18 }} aria-hidden />
                <div
                  className={`gcard ${isSel ? "sel" : ""} ${isDrop ? "drop" : ""} st-${st.tone}`}
                  data-goal-id={g.id}
                  style={{ left: `${left}%`, top: 34 + row * (CARD_H + 10), width: CARD_W }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                    setDragBoth({ kind: "card", goalId: g.id, startX: e.clientX, startPct: pct, moved: false });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(g.id); }
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      const d = new Date(`${g.date}T00:00:00Z`);
                      d.setUTCMonth(d.getUTCMonth() + (e.key === "ArrowRight" ? 1 : -1));
                      const iso = d.toISOString().slice(0, 10);
                      if (iso >= firstOfMonth(now.toISOString())) update(g.id, { date: iso });
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSel}
                  aria-label={`${g.name}, ${cad0.format(effectiveTarget(g))} by ${monthYear(g.date)}, ${st.text}. Arrow keys move it by a month.`}
                >
                  <div className="gtop">
                    <span className="gicon" aria-hidden>{iconFor(g.kind)}</span>
                    <span className="gname">{g.name}</span>
                  </div>
                  <div className="gmeta">{cad0.format(effectiveTarget(g))} · {monthYear(g.date)}</div>
                  <div className="gprog" aria-hidden><div style={{ width: `${p.progressPct}%` }} /></div>
                  <div className={`gstatus ${st.tone}`}>
                    {p.status === "short" ? `Short ${cad0.format(p.gap)}` : st.text}
                    {p.flags.length > 0 && <span className="gflag" title={p.flags.join(" ")}>!</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="chips" aria-label="Your accounts">
        <span className="chips-label">
          {sel ? `Fund “${sel.name}”: tap or drag an account` : "Drag an account onto a goal to fund it"}
        </span>
        {accounts.map((a) => {
          const free = freeShare(a.id);
          return (
            <button
              key={a.id}
              className={`chip-acct ${free <= 0.001 ? "full" : ""}`}
              onPointerDown={(e) => free > 0.001 && startGhost(e, { kind: "account", accountId: a.id })}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && sel && free > 0.001) {
                  e.preventDefault();
                  setGoals((gs) => assignAccount(gs, sel.id, a.id, accounts));
                }
              }}
              disabled={free <= 0.001}
              aria-label={`${a.label}, ${cad0.format(a.valueCad)}, ${Math.round(free * 100)}% unassigned`}
            >
              <span className="ca-name">{a.label}</span>
              <span className="ca-val">{cad0.format(a.valueCad)}</span>
              <span className="ca-free" aria-hidden><span style={{ width: `${free * 100}%` }} /></span>
            </button>
          );
        })}
      </div>

      {sel && (
        <GoalEditor
          goal={sel}
          projection={projections.get(sel.id)!}
          accounts={accounts}
          basis={basis}
          now={now}
          freeShare={freeShare}
          onChange={(patch) => update(sel.id, patch)}
          onShare={(accountId, share) => setGoals((gs) => setShare(gs, sel.id, accountId, share))}
          onAssign={(accountId) => setGoals((gs) => assignAccount(gs, sel.id, accountId, accounts))}
          onDelete={() => { setGoals((gs) => gs.filter((g) => g.id !== sel.id)); setSelected(null); }}
          onClose={() => setSelected(null)}
        />
      )}

      <details className="method">
        <summary>How projections work</summary>
        <ul>
          <li>
            <strong>Typical returns</strong> use long-run averages for what each account holds:{" "}
            {(["cash", "bond", "equity", "gold"] as const).map((k, i) => (
              <span key={k}>{i ? ", " : ""}{ASSUMPTIONS[k].label.toLowerCase()} {(ASSUMPTIONS[k].rate * 100).toFixed(1)}%</span>
            ))}{" "}a year.
          </li>
          <li>
            <strong>My past returns</strong> use each account’s own money-weighted return, where it has a year of
            history. Strong past years don’t promise strong future ones.
          </li>
          <li>
            The range shows a rough low and high (about 1 year in 10 on either side). It’s wider for stocks and
            narrows the longer you have.
          </li>
          <li>Goals are saved in this browser. These are estimates, not financial advice.</li>
        </ul>
      </details>

      {drag && drag.kind !== "card" && drag.moved && (
        <div className="ghost" style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden>
          {drag.kind === "template"
            ? <>{iconFor(drag.template)} {TEMPLATES.find((t) => t.kind === drag.template)!.name}</>
            : <>{dragAccount?.label}</>}
        </div>
      )}
    </section>
  );
}

function GoalEditor(props: {
  goal: Goal;
  projection: GoalProjection;
  accounts: AccountForGoals[];
  basis: ReturnBasis;
  now: Date;
  freeShare: (id: string) => number;
  onChange: (patch: Partial<Goal>) => void;
  onShare: (accountId: string, share: number) => void;
  onAssign: (accountId: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { goal: g, projection: p, accounts, basis, now } = props;
  const target = effectiveTarget(g);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const scaleMax = Math.max(p.high, target, 1) * 1.08;
  const at = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;
  const st = STATUS[p.status];
  const minMonth = now.toISOString().slice(0, 7);
  const unfunded = accounts.filter((a) => !g.sources.some((s) => s.accountId === a.id) && props.freeShare(a.id) > 0.001);

  return (
    <div className="editor" data-goal-id={g.id}>
      <div className="ed-head">
        <span className="gicon big" aria-hidden>{iconFor(g.kind)}</span>
        <input
          className="ed-name"
          value={g.name}
          maxLength={60}
          onChange={(e) => props.onChange({ name: e.target.value })}
          aria-label="Goal name"
        />
        <button className="btn" onClick={props.onClose}>Done</button>
      </div>

      <div className="ed-grid">
        {g.kind === "emergency" ? (
          <>
            <label className="field">
              <span>Monthly expenses</span>
              <input type="number" min={0} step={100} value={g.monthlyExpenses ?? 0}
                onChange={(e) => props.onChange({ monthlyExpenses: Math.max(0, Number(e.target.value)) })} />
            </label>
            <label className="field">
              <span>Months to cover: {g.months ?? 0}</span>
              <input type="range" min={1} max={12} value={g.months ?? 4}
                onChange={(e) => props.onChange({ months: Number(e.target.value) })} />
              <small>Target {cad0.format(target)}</small>
            </label>
          </>
        ) : (
          <label className="field">
            <span>Amount needed: {cad0.format(g.target)}</span>
            <input type="range" min={0} max={Math.max(g.target * 2, 10000)} step={500} value={g.target}
              onChange={(e) => props.onChange({ target: Number(e.target.value) })} />
            <input type="number" min={0} step={500} value={g.target} aria-label="Amount needed"
              onChange={(e) => props.onChange({ target: Math.max(0, Number(e.target.value)) })} />
          </label>
        )}
        <label className="field">
          <span>Needed by</span>
          <input type="month" min={minMonth} value={g.date.slice(0, 7)}
            onChange={(e) => e.target.value && props.onChange({ date: `${e.target.value}-01` })} />
          <small>{p.years < 1 ? `${Math.max(0, Math.round(p.years * 12))} months away` : `${p.years.toFixed(1)} years away`}</small>
        </label>
        <label className="field">
          <span>Saving each month: {cad0.format(g.monthly)}</span>
          <input type="range" min={0} max={3000} step={25} value={g.monthly}
            onChange={(e) => props.onChange({ monthly: Number(e.target.value) })} />
        </label>
      </div>

      <div className="ed-sources">
        <h3>Funded by</h3>
        {g.sources.length === 0 && <p className="muted small">No accounts yet. Tap or drag one from the list above.</p>}
        {g.sources.map((s) => {
          const a = byId.get(s.accountId);
          if (!a) return null;
          const r = accountRate(a, basis);
          const cap = Math.min(1, s.share + props.freeShare(a.id));
          return (
            <div className="src" key={s.accountId}>
              <div className="src-top">
                <span className="acct">{a.label}</span>
                <span>{cad0.format(a.valueCad * s.share)}</span>
              </div>
              <input type="range" min={0} max={100} step={5} value={Math.round(s.share * 100)}
                aria-label={`Share of ${a.label}`}
                onChange={(e) => props.onShare(a.id, Math.min(cap, Number(e.target.value) / 100))} />
              <div className="src-meta">
                <span>{Math.round(s.share * 100)}% of this account</span>
                <span>
                  {(r.rate * 100).toFixed(1)}%/yr {r.source === "past" ? "past" : "typical"}
                  {basis === "past" && r.source === "mix" && " (under a year of history)"}
                </span>
                <button className="linkbtn" onClick={() => props.onShare(a.id, 0)}>Remove</button>
              </div>
            </div>
          );
        })}
        {unfunded.length > 0 && (
          <div className="add-src">
            {unfunded.map((a) => (
              <button key={a.id} className="linkbtn" onClick={() => props.onAssign(a.id)}>+ {a.label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="proj">
        <div className="proj-line">
          <strong className={`gstatus ${st.tone}`}>{st.text}</strong>
          {p.status !== "unfunded" && (
            <span>
              Expected <strong>{cad0.format(p.expected)}</strong> by {monthYear(g.date)}, likely between{" "}
              {cad0.format(p.low)} and {cad0.format(p.high)}.
            </span>
          )}
        </div>
        <div className="pbar" role="img"
          aria-label={`Target ${cad0.format(target)}. Expected ${cad0.format(p.expected)}, range ${cad0.format(p.low)} to ${cad0.format(p.high)}.`}>
          <div className="pbar-now" style={{ width: at(p.fundedNow) }} />
          {p.status !== "unfunded" && <div className="pbar-range" style={{ left: at(p.low), width: `calc(${at(p.high)} - ${at(p.low)})` }} />}
          {p.status !== "unfunded" && <div className="pbar-exp" style={{ left: at(p.expected) }} />}
          <div className="pbar-target" style={{ left: at(target) }}><span>Target</span></div>
        </div>
        <div className="pbar-legend">
          <span><i className="lg-now" /> Today {cad0.format(p.fundedNow)}</span>
          <span><i className="lg-range" /> Likely range</span>
          <span><i className="lg-exp" /> Expected</span>
        </div>
        {p.status === "short" && p.extraMonthlyNeeded > 0 && (
          <p className="fix">
            Saving about <strong>{cad0.format(Math.ceil(p.extraMonthlyNeeded / 5) * 5)}</strong> more a month would close
            the gap.{" "}
            <button className="btn small" onClick={() => props.onChange({ monthly: g.monthly + Math.ceil(p.extraMonthlyNeeded / 5) * 5 })}>
              Add it
            </button>
          </p>
        )}
        {p.flags.map((f, i) => <p key={i} className="flag">{f}</p>)}
      </div>

      <button className="linkbtn danger" onClick={props.onDelete}>Delete goal</button>
    </div>
  );
}
