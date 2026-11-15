/** Un toque entra. El siguiente, mientras el primero no termina, no escribe. */
export function beginTap(guard: { current: boolean }): boolean {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export function endTap(guard: { current: boolean }): void {
  guard.current = false;
}

/** El mismo guardia que usa el botón de crear. */
export async function runGuardedTap<T>(
  guard: { current: boolean },
  work: () => Promise<T>
): Promise<T | undefined> {
  if (!beginTap(guard)) return undefined;
  try {
    return await work();
  } finally {
    endTap(guard);
  }
}
