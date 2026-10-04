# SnapTrade + Wealthsimple: observed API behaviour

Findings from probing a live Wealthsimple connection through SnapTrade (October 2026). Account balances and identifiers are intentionally left out.

## Accounts

- One Wealthsimple login returns **every account ever opened**, including closed and archived ones with zero balance. Filter on `status === "open"` and a non-zero `balance.total.amount`.
- `raw_type` only says `TFSA`, `RRSP`, `PERSONAL`, `CASH`, `CRYPTO`, etc. It does **not** distinguish managed from self-directed.
- The managed/self-directed distinction is in `meta.unifiedAccountType`, e.g. `MANAGED_PORTFOLIO_TFSA`, `SELF_DIRECTED_TFSA`, `MANAGED_SAVE`, `HISA_TFSA`, `PORTFOLIO_LINE_OF_CREDIT`. SnapTrade marks `meta` as deprecated, so the app should let users confirm or relabel accounts.
- A portfolio line of credit appears as an account with `account_category: "LOC"` and a **negative** total. Treat it as a liability, not an investment.
- Paper-trading brokerages (e.g. Alpaca Paper) come back in the same account list with `is_paper: true` and a pretend balance, often in USD. They must be left out of totals; the app drops them and any connection that has only paper accounts.
- A connection's `type` is `read` or `trade`. One created outside this app (for example from the SnapTrade dashboard) may be `trade`, so don't describe a connection as read-only without checking it.

## Positions (`getAllAccountPositions`)

- Self-directed accounts return full positions.
- **Managed portfolios return an empty `positions` list**, even when funded.
- Schema (SDK / REST): `{ results: [{ instrument: { kind, symbol, description, currency, exchange, figi_instrument }, units, price, cost_basis, currency }], data_freshness }`. **The SnapTrade MCP connector renames `results` to `positions`**, so don't copy field names from MCP output into SDK code.
  - Numbers come back as **strings**.
  - `cost_basis` is per unit.
  - `instrument.kind` is `stock`, `etf`, or `other`. Physical gold is `kind: "other"` on exchange `WST-PRECIOUS-METAL`.
- Holdings mix CAD and USD, so totals need FX conversion.

## Activities (`getAccountActivities`)

- Managed accounts **do** expose every rebalancing trade (`BUY`, `SELL`) with symbol, units and price, plus `DIVIDEND`, `INTEREST`, `FEE`, `CONTRIBUTION`, `WITHDRAWAL`, `INTERNAL_CASH_TRANSFER_IN`. This makes holdings reconstructable.
- Paginated: default and maximum 1000 per page, response `{ data, pagination: { offset, limit, total } }`.
- `SELL` has negative units; `BUY` positive.
- **Ticker renames:** the same fund can appear under two tickers (GLOV and GSWO) with the same FIGI. Key on `figi_instrument.figi_share_class`.
- **Inconsistent type codes:** the same ETF can be typed `cs` (Common Stock) in one record and `et` (ETF) in another. Don't classify on `type.code` alone.
- Some `DIVIDEND` rows have `price: 0`; ignore price on non-trade rows.
- A cash-only managed portfolio shows monthly `INTEREST` and no trades after its initial sale of a high-interest savings ETF.

## Open questions

- Activity `amount` is reported in the account currency (CAD) even for USD-listed funds. Whether `price` on those rows is CAD-converted or USD is unconfirmed; the reconstruction assumes account currency.
- Finnhub free-tier coverage of `.TO` tickers is unverified.
- The SnapTrade MCP connector is read-only (no trading), which matches this project's scope.
