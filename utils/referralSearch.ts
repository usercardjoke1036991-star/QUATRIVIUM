export function normalizeReferralQuery(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

export function referralPersonMatches(
  query: string,
  person: { name?: string; code?: string; address?: string }
): boolean {
  const needle = normalizeReferralQuery(query);
  if (!needle) return true;
  const name = normalizeReferralQuery(person.name || '');
  const code = normalizeReferralQuery(person.code || '');
  const address = normalizeReferralQuery(person.address || '');
  return name.includes(needle) || code.includes(needle) || address.includes(needle);
}
