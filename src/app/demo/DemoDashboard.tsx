import { buildPortfolio } from "@/lib/portfolio-build";
import { DEMO_IDS, DEMO_PLAY, demoGoals, demoSource } from "@/lib/demo";
import DashboardView from "../DashboardView";

/** The full dashboard on invented sample data. Reads no keys and makes no network calls. */
export default async function DemoDashboard() {
  const now = new Date();
  const portfolio = await buildPortfolio(demoSource(now));
  const cash = portfolio.accounts.find((a) => a.id === DEMO_IDS.cash)?.totalCad ?? 0;
  return (
    <DashboardView
      portfolio={portfolio} loadError={null} justConnected={false} signOut={false}
      demo={{ seedGoals: demoGoals(now, cash), seedPlay: DEMO_PLAY }}
    />
  );
}
