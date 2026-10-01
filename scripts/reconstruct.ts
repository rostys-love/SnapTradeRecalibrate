// Port Calibrate: reconstruct every open, funded managed account.
// Run: npm run reconstruct   (needs SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in .env.local)
import { config } from "dotenv";
import { Snaptrade, SnaptradeAuth } from "snaptrade-typescript-sdk";
import { reconstructAccount } from "../src/reconstruct/snaptrade";

config({ path: ".env.local" });
const { SNAPTRADE_CLIENT_ID: clientId, SNAPTRADE_CONSUMER_KEY: consumerKey } = process.env;
if (!clientId || !consumerKey) throw new Error("Missing SNAPTRADE_CLIENT_ID or SNAPTRADE_CONSUMER_KEY");

const snaptrade = new Snaptrade({ auth: SnaptradeAuth.personalApiKey({ clientId, consumerKey }) });

async function main() {
  const accounts: any[] = (await snaptrade.accountInformation.listUserAccounts()).data as any[];
  const managed = accounts.filter(
    (a) =>
      a.status === "open" &&
      (a.balance?.total?.amount ?? 0) > 0 &&
      String(a.meta?.unifiedAccountType ?? "").startsWith("MANAGED"),
  );
  console.log(`Found ${managed.length} open managed account(s).\n`);

  for (const a of managed) {
    const view = await reconstructAccount(snaptrade, a.id, { fallbackProfile: "balanced" });
    console.log(`${a.meta?.unifiedAccountType} — ${view.status.toUpperCase()}`);
    console.log(
      `  reported ${view.reportedTotal?.toFixed(2)} ${view.currency}, reconstructed ${view.reconstructedTotal.toFixed(2)}` +
        (view.diffPct != null ? ` (${view.diffPct >= 0 ? "+" : ""}${view.diffPct.toFixed(1)}%)` : ""),
    );
    console.log(`  activities read: ${view.activitiesRead}, cash: ${view.cash.toFixed(2)}`);
    for (const h of view.holdings) {
      console.log(`  ${h.ticker.padEnd(10)} ${h.assetClass.padEnd(7)} ${h.units.toFixed(4).padStart(10)} units  ${h.value.toFixed(2).padStart(10)}  [${h.priceSource}]`);
    }
    for (const w of view.warnings) console.log(`  ! ${w}`);
    console.log();
  }
}

main().catch((e) => {
  console.error("Failed:", e?.response?.data?.detail ?? e?.message ?? e);
  process.exit(1);
});
