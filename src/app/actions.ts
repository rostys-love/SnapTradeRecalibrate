"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";
import { snaptrade } from "@/lib/snaptrade";
import { demoModeEnabled } from "@/lib/demo-mode";

async function siteOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Sends you to SnapTrade's hosted Connection Portal, where you sign in to Wealthsimple.
 * This site never sees your Wealthsimple password. Pass a connection id to repair a disabled connection.
 */
export async function connectWealthsimple(formData: FormData) {
  if (demoModeEnabled()) redirect("/"); // the public demo never talks to SnapTrade
  await requireSession();
  const reconnect = String(formData.get("reconnect") ?? "") || undefined;
  const res = await snaptrade().authentication.loginSnapTradeUser({
    broker: "WEALTHSIMPLETRADE",
    connectionType: "read",
    immediateRedirect: true,
    customRedirect: `${await siteOrigin()}/?connected=1`,
    reconnect,
  });
  const url = (res.data as any)?.redirectURI;
  if (!url) throw new Error("SnapTrade did not return a connection portal link");
  redirect(url);
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
