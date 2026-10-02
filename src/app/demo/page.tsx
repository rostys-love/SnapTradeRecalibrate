import type { Metadata } from "next";
import DemoDashboard from "./DemoDashboard";

export const dynamic = "force-dynamic"; // sample dates are relative to today
export const metadata: Metadata = { title: "Port Calibrate · Demo" };

export default function DemoPage() {
  return <DemoDashboard />;
}
