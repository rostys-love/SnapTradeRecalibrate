import { requireSession, showSignOut } from "@/lib/auth";
import { getPortfolio, type Portfolio } from "@/lib/portfolio";
import { friendlyError } from "@/lib/errors";
import { demoModeEnabled } from "@/lib/demo-mode";
import DashboardView from "./DashboardView";
import DemoDashboard from "./demo/DemoDashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // A DEMO_MODE deployment is public and only ever shows sample data
  if (demoModeEnabled()) return <DemoDashboard />;

  await requireSession();
  const params = await searchParams;

  let portfolio: Portfolio | null = null;
  let loadError: string | null = null;
  try {
    portfolio = await getPortfolio();
  } catch (e) {
    loadError = friendlyError(e);
  }

  return <DashboardView portfolio={portfolio} loadError={loadError} justConnected={Boolean(params.connected)} signOut={showSignOut()} />;
}
