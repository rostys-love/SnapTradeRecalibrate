import "server-only";
import { fetchAllActivities } from "@/reconstruct/snaptrade";
import { snaptrade } from "./snaptrade";
import { rateToCad } from "./fx";
import { getMarketData } from "./finnhub";
import { buildPortfolio, type Portfolio, type PortfolioSource } from "./portfolio-build";

export type { ConnectionStatus, Portfolio } from "./portfolio-build";

/** Live data: SnapTrade for accounts, Finnhub for quotes, the Bank of Canada for exchange rates. */
function liveSource(): PortfolioSource {
  const client = snaptrade();
  return {
    accounts: async () => ((await client.accountInformation.listUserAccounts()).data as any[]) ?? [],
    connections: async () => ((await client.connections.listBrokerageAuthorizations()).data as any[]) ?? [],
    positions: async (accountId) => (await client.accountInformation.getAllAccountPositions({ accountId })).data,
    balances: async (accountId) => ((await client.accountInformation.getUserAccountBalance({ accountId })).data as any[]) ?? [],
    activities: (accountId) => fetchAllActivities(client, accountId),
    rateToCad,
    marketData: (tickers) => getMarketData(tickers),
    marketDataEnabled: Boolean(process.env.FINNHUB_API_KEY),
  };
}

export async function getPortfolio(): Promise<Portfolio> {
  return buildPortfolio(liveSource());
}
