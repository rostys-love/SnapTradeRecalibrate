"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Sticky header with the section menu. Sections switch through the URL hash (#goals, #holdings),
 * so links, refresh and the back button all work. "#holdings:some-id" also scrolls to that element.
 */
export default function Shell({ tabs, actions, notices }: { tabs: Tab[]; actions: ReactNode; notices?: ReactNode }) {
  const ids = tabs.map((t) => t.id);
  const [active, setActive] = useState(ids[0]);
  const idsKey = ids.join("|");
  const first = useRef(true);

  useEffect(() => {
    const valid = idsKey.split("|");
    const sync = () => {
      const [tab, target] = decodeURIComponent(location.hash.slice(1)).split(":");
      const next = valid.includes(tab) ? tab : valid[0];
      setActive(next);
      const initial = first.current;
      first.current = false;
      // wait for the panel to become visible before scrolling
      setTimeout(() => {
        const el = target ? document.getElementById(target) : null;
        if (el) el.scrollIntoView({ behavior: initial ? "auto" : "smooth", block: "start" });
        else if (!initial) window.scrollTo({ top: 0 });
      }, 30);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [idsKey]);

  return (
    <>
      <header className="appbar">
        <div className="appbar-in">
          <a className="brand" href={`#${ids[0]}`}>
            <span className="logo" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16l5-5 4 4 7-8" />
                <path d="M15 7h5v5" />
              </svg>
            </span>
            Port Calibrate
          </a>
          {tabs.length > 1 && (
            <nav className="menu" aria-label="Sections">
              {tabs.map((t) => (
                <a key={t.id} href={`#${t.id}`} aria-current={active === t.id ? "page" : undefined}>
                  {t.label}
                </a>
              ))}
            </nav>
          )}
          <div className="actions">{actions}</div>
        </div>
      </header>
      <main className="wrap">
        {notices}
        {tabs.map((t) => (
          <div key={t.id} id={`panel-${t.id}`} className="panel" hidden={active !== t.id}>
            {t.content}
          </div>
        ))}
      </main>
    </>
  );
}
