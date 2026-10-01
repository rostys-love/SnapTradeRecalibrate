import { requireSession, showSignOut } from "@/lib/auth";
import { getPortfolio, type Portfolio } from "@/lib/portfolio";
import { friendlyError } from "@/lib/errors";
import DashboardView from "./DashboardView";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
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
