const RESERVED = new Set([
  'admin',
  'owner',
  'fundador',
  'founder',
  'support',
  'ayuda',
  'quatrivium',
  'official',
  'oficial',
  'root',
  'null',
  'undefined',
]);

export function normalizeUsername(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
}

export function isValidUsername(value: string): boolean {
  const username = normalizeUsername(value);
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(username)) return false;
  return !RESERVED.has(username);
}
