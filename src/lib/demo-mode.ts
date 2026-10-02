/**
 * DEMO_MODE=1 turns a deployment into a public demo: every page shows the invented sample data from
 * demo.ts and nothing can reach SnapTrade. Such a deployment needs no API keys and should have none.
 */
export const demoModeEnabled = () => process.env.DEMO_MODE === "1";
