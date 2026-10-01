# Port Calibrate

Goal-aware portfolio insights for Wealthsimple investors, built on the [SnapTrade API](https://docs.snaptrade.com/).

Port Calibrate connects to your Wealthsimple accounts, works out what you actually hold (including inside managed portfolios), and answers a practical question: **when you need money for a milestone, which account should it come from so your long-term plan takes the smallest hit?**

Built for the [SnapTrade student project program](https://snaptrade.com/students) (Hack Atlantic 2026).

## Status

| Piece | State |
|---|---|
| SnapTrade connection + data probe | Done (`scripts/probe.ts`) |
| Holdings reconstruction for managed accounts | Done, unit-tested (`src/reconstruct`) |
| Live quotes (Finnhub) | Wired as optional provider; TSX coverage unverified |
| Milestones, withdrawal advisor, UI | Not started |

## How it works

SnapTrade returns full positions for self-directed accounts, but **managed Wealthsimple portfolios come back with an empty positions list**. Their trades do appear in account activities, so Port Calibrate rebuilds the holdings:

1. Page through every activity for the account (`offset`/`limit`, 1000 per page).
2. Net the units per security, keyed by FIGI share class so ticker renames merge (for example GLOV → GSWO).
3. Price each holding (live quote if available, otherwise last trade price, flagged as stale).
4. Compare the rebuilt total with the account total SnapTrade reports. Within 3%, trust it; otherwise fall back to a risk-profile estimate and say so.

See [docs/FINDINGS.md](docs/FINDINGS.md) for what the API actually returns for Wealthsimple.

## Setup

Requires Node 20+, a free [SnapTrade Personal account](https://dashboard.snaptrade.com/signup) with Wealthsimple connected, 2FA enabled, and a Personal API key.

```bash
npm install
cp .env.example .env.local   # then fill in your keys
npm test                     # unit tests, no network
npm run typecheck
npm run probe                # inspect what your accounts return; writes probe-report.json
npm run reconstruct          # rebuild holdings for open managed accounts
```

## Security

- A SnapTrade Personal API key reads your brokerage data and may be able to trade. Keep it in `.env.local` (git-ignored) or your host's server-side environment settings. Never prefix it with `NEXT_PUBLIC_` or send it to the browser.
- A Personal key represents you. It must not be embedded in an app other people use; that needs SnapTrade OAuth or a Commercial key.
- `probe-report.json` contains masked but real account data and is git-ignored. Don't commit it.
- This project is read-only. It never places orders.

## Project layout

```
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
