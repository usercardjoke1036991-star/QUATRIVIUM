/** Un toque entra. El siguiente, mientras el primero no termina, no escribe. */
export function beginTap(guard: { current: boolean }): boolean {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export function endTap(guard: { current: boolean }): void {
  guard.current = false;
}
