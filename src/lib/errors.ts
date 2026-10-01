/** Turns SDK/axios errors into one readable line. Never includes headers or response bodies. */
export function friendlyError(e: any): string {
  const status: number | undefined = e?.response?.status ?? e?.status;
  const detail: unknown = e?.response?.data?.detail;
  if (typeof detail === "string" && detail.length < 300) return detail;
  if (status === 401 || status === 403) {
    return `SnapTrade refused the request (HTTP ${status}). Check SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY.`;
  }
  if (status === 429) return "SnapTrade rate limit reached. Wait a minute and refresh.";
  if (status && status >= 500) return `SnapTrade or the brokerage is temporarily unavailable (HTTP ${status}). Try again shortly.`;
  const msg = String(e?.message ?? e ?? "Unknown error");
  return msg.split("\n")[0].slice(0, 200);
}
