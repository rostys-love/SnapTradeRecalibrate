import "server-only";
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import type { PersonalClient } from "@/reconstruct/snaptrade";
import { demoModeEnabled } from "./demo-mode";

let client: PersonalClient | null = null;

/** Server-only SnapTrade client using your Personal API key. Never import this from client components. */
export function snaptrade(): PersonalClient {
  if (demoModeEnabled()) throw new Error("SnapTrade is switched off in demo mode");
  if (client) return client;
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY;
  if (!clientId || !consumerKey) {
    throw new Error("SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY must be set");
  }
  client = new Snaptrade({ auth: SnaptradeAuth.personalApiKey({ clientId, consumerKey }) });
  return client;
}
