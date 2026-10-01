import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isValidSession, passwordGateEnabled } from "./session";

/** Second line of defence behind src/proxy.ts: call at the top of every page and action that reads data. */
export async function requireSession(): Promise<void> {
  if (!passwordGateEnabled()) return;
  const store = await cookies();
  if (!isValidSession(store.get(SESSION_COOKIE)?.value)) redirect("/login");
}

export const showSignOut = () => passwordGateEnabled();
