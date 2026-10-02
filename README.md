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
| Goals timeline (cards, funding, projections) | Done; saved in the browser |
| "I need money" withdrawal planner | Done, unit-tested (`src/lib/withdraw.ts`) |

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
- **Your goals.** Pick a goal (emergency fund, car, house, baby, retirement, …), drag it along a Now → 20-year timeline to when you need the money, then drag or tap accounts onto it to fund it. Tapping an account gives only what the goal still needs; accounts can be split across goals but never past 100%. Each goal shows today's funding, an expected value at its date with a likely low–high range, and a status (on track, likely, short). Short goals get a one-tap "save $X more a month" fix, and mismatches are flagged (e.g. a goal under 3 years away funded mostly by stocks). Projections use either typical long-run returns for each account's mix or the account's own past return. Goals are saved in the browser for now.
- **Need money.** Enter an amount, what it's for, and when you can put it back. The page shows the cheapest way to raise it (split across accounts if needed) and what it would cost to take it all from each account: missed growth, tax, and interest if you borrow on a line of credit. It uses money set aside for that purpose first, then money not promised to any goal, then goal money or borrowing (whichever is cheaper), and RRSP/FHSA last. Goals that would be set back are listed, self-directed accounts say what to sell, and the tax figures are rough estimates, not advice.
- **Where your growth came from.** Per account: money put in (deposits and transfers in, minus withdrawals), value now, gain, its share of your total growth, and a money-weighted annual return (XIRR) once it has a year of history. Also totals fees and line-of-credit interest. Managed accounts are named by what they hold (Cash, Conservative, Balanced, Growth).
- **Holding details (click a row).** Built from your activity history: when you first and last bought, how long you've held it, every buy and sell, average cost and realized gains (average-cost method, as used for Canadian ACB), and dividends received with yield on cost. Managed holdings get a cost basis this way too. With `FINNHUB_API_KEY` set, US listings also show today's change, your position's move in CAD, beta and the 52-week range. Finnhub's free plan generally doesn't cover TSX listings; those rows say so. Wealthsimple-held assets such as physical gold are never looked up, since their tickers collide with unrelated stocks.

```
src/app/page.tsx          holdings dashboard (server-rendered on each visit)
src/app/login/            password page
src/app/actions.ts        Connect Wealthsimple, sign out
src/proxy.ts              redirects anything without a session to /login
src/lib/portfolio.ts      loads accounts from SnapTrade into view models
src/lib/positions.ts      pure normalization and enrichment (tested)
src/lib/history.ts        purchase history, holding dates, dividends, average cost (tested)
src/lib/returns.ts        money in, gain, fees, money-weighted annual return (tested)
src/lib/goals.ts          goal projections, funding splits, timeline scale (tested)
src/app/GoalsBoard.tsx    drag-and-drop goals timeline and editor
src/lib/withdraw.ts       cost of taking money from each account, recommended plan (tested)
src/app/WithdrawPlanner.tsx  the "Need money" page
src/lib/finnhub.ts        cached Finnhub quotes and metrics
src/app/HoldingsTable.tsx expandable holdings table
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
