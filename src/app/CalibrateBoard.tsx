"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BUCKETS, PRESETS, type Bucket, type CalHolding, type CustomTargets, bucketOf, calibrate, customPreset, playKey,
} from "@/lib/calibrate";

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const pct = (v: number) => `${Math.round(v)}%`;
const BUCKET_IDS = Object.keys(BUCKETS) as Bucket[];
const DEFAULT_CUSTOM: CustomTargets = { stocks: 25, funds: 40, bonds: 30, play: 5 };

interface Saved {
  preset: string;
  custom: CustomTargets;
  play: string[];
}

export default function CalibrateBoard(
  { holdings, cashCad, storageNs = "pc", seedPlay }: { holdings: CalHolding[]; cashCad: number; storageNs?: string; seedPlay?: string[] },
) {
  const KEY = `${storageNs}_calibrate_v1`;
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [custom, setCustom] = useState<CustomTargets>(DEFAULT_CUSTOM);
  const [play, setPlay] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load after mount so server and client render the same first frame
  useEffect(() => {
    let saved: Partial<Saved> | null = null;
    try {
      const raw = window.localStorage.getItem(KEY);
      saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    } catch {
      saved = null;
    }
    if (saved) {
      if (typeof saved.preset === "string" && (saved.preset === "custom" || PRESETS.some((p) => p.id === saved!.preset))) setPresetId(saved.preset);
      if (saved.custom && typeof saved.custom === "object") {
        setCustom(Object.fromEntries(BUCKET_IDS.map((b) => [b, Math.min(100, Math.max(0, Number(saved!.custom![b]) || 0))])) as CustomTargets);
      }
      if (Array.isArray(saved.play)) setPlay(saved.play.filter((x) => typeof x === "string").slice(0, 200));
    } else if (seedPlay) {
      setPlay(seedPlay);
    }
    setLoaded(true);
  }, [KEY, seedPlay]);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(KEY, JSON.stringify({ preset: presetId, custom, play } satisfies Saved)); } catch { /* still works for this visit */ }
  }, [presetId, custom, play, loaded, KEY]);

  const preset = presetId === "custom" ? customPreset(custom) : PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const playSet = useMemo(() => new Set(play), [play]);
  const result = useMemo(() => calibrate(holdings, preset, playSet), [holdings, preset, playSet]);

  const customTotal = BUCKET_IDS.reduce((s, b) => s + custom[b], 0);
  const usesPlay = preset.groups.some((g) => g.buckets.length === 1 && g.buckets[0] === "play");
  const taggable = useMemo(() => {
    const seen = new Map<string, CalHolding>();
    for (const h of holdings) if (h.canPick && h.assetClass === "equity" && !seen.has(playKey(h))) seen.set(playKey(h), h);
    return [...seen.values()].sort((a, b) => b.valueCad - a.valueCad);
  }, [holdings]);
  const toggle = (key: string) => setPlay((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  const scale = Math.max(10, Math.ceil(Math.max(...result.groups.flatMap((g) => [g.currentPct, g.pct])) / 10) * 10);

  if (holdings.length === 0) {
    return <section className="card cal-card"><h2>Calibrate your mix</h2><p className="goals-sub">There are no investments to compare yet.</p></section>;
  }

  return (
    <div className="cal">
      <section className="card cal-card">
        <h2>Calibrate your mix</h2>
        <p className="goals-sub">Pick a rule to see how your invested money compares, and what would close the gap.</p>
        <div className="wd-seg cal-presets" role="group" aria-label="Target rule">
          {[...PRESETS.map((p) => ({ id: p.id, name: p.name })), { id: "custom", name: "My own" }].map((p) => (
            <button key={p.id} type="button" className={presetId === p.id ? "on" : ""} aria-pressed={presetId === p.id} onClick={() => setPresetId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="cal-blurb">{preset.blurb}</p>
        {presetId === "custom" && (
          <div className="ed-grid cal-custom">
            {BUCKET_IDS.map((b) => (
              <label key={b} className="field">
                <span>{BUCKETS[b].label}: {custom[b]}%</span>
                <input type="range" min={0} max={100} step={5} value={custom[b]} onChange={(e) => setCustom((c) => ({ ...c, [b]: Number(e.target.value) }))} />
              </label>
            ))}
            {customTotal !== 100 && (
              <p className="small muted cal-scaled">
                These add up to {customTotal}%, so they’re scaled to 100%: {preset.groups.map((g) => `${g.label.toLowerCase()} ${pct(g.pct)}`).join(", ")}.
              </p>
            )}
          </div>
        )}

        <div className="cal-rows">
          {result.groups.map((g) => (
            <div key={g.id} className={`cal-row ${g.status}`}>
              <div className="cal-row-top">
                <b>{g.label}</b>
                <span className="muted">{pct(g.currentPct)} now · target {pct(g.pct)}</span>
                <span className="cal-diff">
                  {g.status === "ok" ? "On target" : `${cad.format(Math.abs(g.diff))} ${g.status === "over" ? "too much" : "too little"}`}
                </span>
              </div>
              <div className="cal-bar" role="img" aria-label={`${g.label}: ${pct(g.currentPct)} now, target ${pct(g.pct)}`}>
                <div className="fill" style={{ width: `${Math.min(100, (g.currentPct / scale) * 100)}%` }} />
                <div className="mark" style={{ left: `${Math.min(100, (g.pct / scale) * 100)}%` }}><span>{pct(g.pct)}</span></div>
              </div>
            </div>
          ))}
        </div>
        <p className="meta cal-meta">
          Shares of {cad.format(result.invested)} invested.
          {cashCad > 1 && ` ${cad.format(cashCad)} in cash is left out of the rule.`}
          {result.outside > 1 && ` So is ${cad.format(result.outside)} in gold or other holdings.`}
        </p>
      </section>

      <section className="wd-plan" aria-live="polite">
        <div className="wd-plan-head">
          <div>
            <div className="hero-k">To get to {preset.name}</div>
            <h3>
              {result.balanced
                ? "You’re already on target"
                : result.shift > 0.5
                  ? `Move about ${cad.format(result.shift)}`
                  : "Nothing you can trade yourself"}
            </h3>
          </div>
          {!result.balanced && result.moves.length > 0 && (
            <div className="wd-plan-cost">
              <b>{result.moves.reduce((s, m) => s + m.sells.length + m.buys.length, 0)}</b>
              <span>trades to place yourself</span>
            </div>
          )}
        </div>

        {result.balanced && <p className="wd-ok">Every part is within {cad.format(result.tolerance)} of its target, so there’s nothing to do.</p>}

        {result.moves.length > 0 && (
          <ol className="wd-parts">
            {result.moves.map((m) => (
              <li key={m.accountId}>
                <div className="wd-part-top">
                  <span className="wd-part-from">In <b>{m.accountLabel}</b></span>
                  <span className="wd-why">{m.taxFree ? "No tax on sales here" : "Sales here can be taxed"}</span>
                </div>
                <ul className="wd-sells">
                  {m.sells.map((s) => (
                    <li key={`s-${s.ticker}`}>
                      <span>Sell about <b>{cad.format(s.amount)}</b> of <span className="ticker">{s.ticker}</span><span className="muted"> {s.name}</span></span>
                      {s.gain != null && Math.abs(s.gain) > 0.5 && (
                        <span className={s.gain >= 0 ? "gain" : "loss"}>{s.gain >= 0 ? "+" : "−"}{cad.format(Math.abs(s.gain))} {s.gain >= 0 ? "gain" : "loss"}</span>
                      )}
                    </li>
                  ))}
                  {m.buys.map((b) => (
                    <li key={`b-${b.groupId}`} className="buy">
                      <span>
                        Buy about <b>{cad.format(b.amount)}</b> of {b.what}
                        {b.have.length > 0 && <span className="muted"> (you hold {b.have.join(", ")} here)</span>}
                      </span>
                      <span className="muted">{b.label}</span>
                    </li>
                  ))}
                </ul>
                {!m.taxFree && m.taxableGain > 0.5 && (
                  <div className="wd-part-sub">Selling realizes about {cad.format(m.taxableGain)} of capital gains; half of that is taxable.</div>
                )}
              </li>
            ))}
          </ol>
        )}

        {result.stuck > 0.5 && (
          <p className="flag">
            {result.shift > 0.5 ? "The other " : ""}{cad.format(result.stuck)} of the gap sits in {result.stuckIn.join(" and ") || "managed accounts"},
            where the brokerage chooses the holdings. To shift it you would change that portfolio’s risk level, or point new deposits at what’s too low.
          </p>
        )}
      </section>

      {usesPlay && taggable.length > 0 && (
        <section className="card cal-card">
          <h3 className="cal-h3">What counts as play money?</h3>
          <p className="goals-sub">Tap the holdings you treat as a gamble. Crypto is always counted.</p>
          <div className="cal-tags">
            {taggable.map((h) => {
              const on = playSet.has(playKey(h));
              return (
                <button key={playKey(h)} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => toggle(playKey(h))}>
                  <span className="ticker">{h.ticker}</span> {cad.format(h.valueCad)}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <details className="card wd-settings">
        <summary>How this works</summary>
        <ul className="wd-notes">
          <li><b>Buckets:</b> individual stocks are single companies; stock funds are ETFs that hold stocks; bond ETFs count as bonds, not as stock funds, so nothing is counted twice; play money is crypto plus anything you tag.</li>
          <li><b>Current mix</b> is {(() => {
            const parts = BUCKET_IDS.map((b) => {
              const v = holdings.filter((h) => bucketOf(h, playSet) === b).reduce((s, h) => s + h.valueCad, 0);
              return `${BUCKETS[b].label.toLowerCase()} ${cad.format(v)}`;
            });
            return parts.join(", ");
          })()}. Managed accounts are included.</li>
          <li><b>Moves</b> are only suggested in self-directed accounts, and proceeds are spent in the same account. TFSA and RRSP accounts go first because selling inside them isn’t taxed; in a taxable account, losing positions go before winners.</li>
          <li>A part within 1% of its target (or $100) counts as on target.</li>
          <li>This app is read-only: it can’t place trades. The rules are illustrations to compare against, not financial advice.</li>
        </ul>
      </details>
    </div>
  );
}
