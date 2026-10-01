# Port Calibrate

Goal-aware portfolio insights for Wealthsimple investors, built on the [SnapTrade API](https://docs.snaptrade.com/).

Port Calibrate connects to your Wealthsimple accounts, works out what you actually hold (including inside managed portfolios), and answers a practical question: **when you need money for a milestone, which account should it come from so your long-term plan takes the smallest hit?**

Built for the [SnapTrade student project program](https://snaptrade.com/students) (Hack Atlantic 2026).

## Status

| Piece | State |
|---|---|
| SnapTrade connection + data probe | Done (`scripts/probe.ts`) |
| Holdings reconstruction for managed accounts | Done, unit-tested (`src/reconstruct`) |
| Holdings website (Next.js, deploys to Vercel) | Done: password gate, Connect Wealthsimple, holdings per account |
| Live quotes (Finnhub) | Wired as optional provider; TSX coverage unverified |
| Milestones and withdrawal advisor | Not started |

## How it works

SnapTrade returns full positions for self-directed accounts, but **managed Wealthsimple portfolios come back with an empty positions list**. Their trades do appear in account activities, so Port Calibrate rebuilds the holdings:

1. Page through every activity for the account (`offset`/`limit`, 1000 per page).
2. Net the units per security, keyed by FIGI share class so ticker renames merge (for example GLOV → GSWO).
3. Price each holding (live quote if available, otherwise last trade price, flagged as stale).
4. Compare the rebuilt total with the account total SnapTrade reports. Within 3%, trust it; otherwise fall back to a risk-profile estimate and say so.

See [docs/FINDINGS.md](docs/FINDINGS.md) for what the API actually returns for Wealthsimple.

## The website

A private, single-user dashboard:

- **Access control.** By default the site relies on **Vercel Authentication**: only you, signed in to Vercel, can open it. Alternatively, set `SITE_PASSWORD` and `SESSION_SECRET` to use the app's own password page (a signed HttpOnly cookie, checked in `src/proxy.ts` and again on the server). Never run it with neither: the page shows your real balances.
- **Connect Wealthsimple.** Sends you to SnapTrade's hosted Connection Portal. **This site never sees your Wealthsimple password**; SnapTrade handles the login and MFA, then redirects back. If a connection becomes disabled, the same button repairs it.
- **Holdings.** Every open account with its holdings, value in CAD (USD converted at the Bank of Canada daily rate), gain vs cost where known, and asset mix. Managed portfolios are rebuilt from activity history and labelled as such. A portfolio line of credit is shown as a liability.

```
src/app/page.tsx          holdings dashboard (server-rendered on each visit)
src/app/login/            password page
src/app/actions.ts        Connect Wealthsimple, sign out
src/proxy.ts              redirects anything without a session to /login
src/lib/portfolio.ts      loads accounts from SnapTrade into view models
src/lib/positions.ts      pure normalization (tested)
src/lib/session.ts        signed session cookie (tested)
src/lib/fx.ts             Bank of Canada exchange rates
```

### Deploy to Vercel (protected by Vercel Authentication)

The order matters: turn protection on **before** the site has your SnapTrade keys, so it is never public with real data.

1. On [vercel.com/new](https://vercel.com/new), import `SnapTradeRecalibrate`. Keep the defaults and **don't add any environment variables yet**. Deploy. (The page will only show "Couldn't reach SnapTrade", which is fine.)
2. Project → **Settings** → **Deployment Protection** → enable **Vercel Authentication** with scope **All Deployments**. Save.
3. In a private/incognito window, open your `.vercel.app` URL. You should get a Vercel login page, not the app. If you see the app, protection is not on; stop here.
4. Project → **Settings** → **Environment Variables**, add `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY` (as Sensitive), plus `FINNHUB_API_KEY` if you have one. Leave `SITE_PASSWORD` and `SESSION_SECRET` unset.
5. **Deployments** → ⋯ on the latest → **Redeploy**, so the new variables take effect.
6. Open the URL in your normal browser (signed in to Vercel). Your holdings load; **Connect Wealthsimple** is there if you need to add or repair a connection.

Changing an environment variable always needs a redeploy.

### Run locally

```bash
npm install
cp .env.example .env.local   # fill in the keys above
npm run dev                  # http://localhost:3000
```

## Scripts and tests

Requires Node 20+, a free [SnapTrade Personal account](https://dashboard.snaptrade.com/signup) with Wealthsimple connected, 2FA enabled, and a Personal API key.

```bash
npm test                     # unit tests, no network
npm run typecheck
npm run probe                # inspect what your accounts return; writes probe-report.json
npm run reconstruct          # rebuild holdings for open managed accounts
```

## Security

- A SnapTrade Personal API key reads your brokerage data and may be able to trade. Keep it in `.env.local` (git-ignored) or your host's server-side environment settings. Never prefix it with `NEXT_PUBLIC_` or send it to the browser.
- A Personal key represents you. It must not be embedded in an app other people use; that needs SnapTrade OAuth or a Commercial key.
- `probe-report.json` contains masked but real account data and is git-ignored. Don't commit it.
- The website is for one person (you). A Personal key must not power a site other people log in to with their own brokerages; that needs SnapTrade OAuth or a Commercial key.
- Pages are sent with `Cache-Control: private, no-store` and `noindex`, so financial data isn't cached by Vercel's CDN or indexed by search engines.
- This project is read-only. It never places orders.

## Project layout

```
src/app, src/lib, src/proxy.ts the website (see above)
src/reconstruct/core.ts        pure logic: aggregation, classification, pricing, reconciliation
src/reconstruct/snaptrade.ts   SnapTrade I/O: pagination, retries, account reconstruction
src/reconstruct/core.test.ts   unit tests (node:test)
scripts/probe.ts               one-off check of every SnapTrade call + Finnhub coverage
scripts/reconstruct.ts         reconstruct all open managed accounts
docs/FINDINGS.md               API behaviour observed on a live Wealthsimple connection
docs/planning/                 early research and plans (superseded in places; kept for history)
```

## Disclaimer

Port Calibrate is a student project, not financial advice. Its output is an estimate built from brokerage data that may be incomplete or delayed.
