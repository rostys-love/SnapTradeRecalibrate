"use client";

/** Shown on the demo: says the data is invented and lets a visitor put the sample goals back. */
export default function DemoBanner({ storageNs }: { storageNs: string }) {
  const reset = () => {
    try {
      for (const key of Object.keys(window.localStorage)) if (key.startsWith(`${storageNs}_`)) window.localStorage.removeItem(key);
    } catch {
      /* nothing stored */
    }
    window.location.reload();
  };
  return (
    <div className="banner demo-banner">
      <span>
        <strong>This is a demo.</strong> The person, accounts, trades and prices are made up. The real app reads your own
        Wealthsimple accounts through SnapTrade and is private to you. Change anything you like; it stays in this browser.
      </span>
      <button type="button" className="btn small" onClick={reset}>Reset demo</button>
    </div>
  );
}
