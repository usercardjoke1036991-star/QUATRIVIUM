export const REFERRAL_MAX_DEPTH = 12;

export function normalizeBranchKey(address: string): string {
  return String(address || '')
    .trim()
    .toLowerCase();
}

export function canExpandReferralDepth(depth: number): boolean {
  return Number.isFinite(depth) && depth >= 1 && depth < REFERRAL_MAX_DEPTH;
}

export function isBranchOpen(open: Record<string, boolean>, address: string): boolean {
  return Boolean(open[normalizeBranchKey(address)]);
}

export function toggleBranchOpen(
  open: Record<string, boolean>,
  address: string
): Record<string, boolean> {
  const key = normalizeBranchKey(address);
  if (!key) return open;
  return { ...open, [key]: !open[key] };
}

export function uniqueBranchAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const address of addresses) {
    const key = normalizeBranchKey(address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}
