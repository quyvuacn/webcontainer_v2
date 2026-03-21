/**
 * Active handles — process stays alive while count > 0.
 * Used by http, timers, etc. to block process.exit until released.
 */

export function addActiveHandle(): () => void {
  const g = globalThis as Record<string, unknown>;
  g.__wcActiveHandleCount = ((g.__wcActiveHandleCount as number) ?? 0) + 1;
  return () => {
    const c = (g.__wcActiveHandleCount as number) ?? 0;
    g.__wcActiveHandleCount = Math.max(0, c - 1);
  };
}
