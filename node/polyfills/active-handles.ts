/**
 * Active handles — process stays alive while count > 0.
 * Used by http, timers, etc. to block process.exit until released.
 */

import { WC_ACTIVE_HANDLE_COUNT } from "../../js/lib/wc_globals";

export function addActiveHandle(): () => void {
  const g = globalThis as Record<string, unknown>;
  g[WC_ACTIVE_HANDLE_COUNT] = ((g[WC_ACTIVE_HANDLE_COUNT] as number) ?? 0) + 1;
  return () => {
    const c = (g[WC_ACTIVE_HANDLE_COUNT] as number) ?? 0;
    g[WC_ACTIVE_HANDLE_COUNT] = Math.max(0, c - 1);
  };
}
