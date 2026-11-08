export function normalizeEmail(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

const GMAIL = new Set(['gmail.com', 'googlemail.com']);
const PROTON = new Set(['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me']);

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}

export function isAllowedEmailProvider(value: string): boolean {
  const domain = domainOf(normalizeEmail(value));
  return GMAIL.has(domain) || PROTON.has(domain);
}

export function canonicalEmail(value: string): string {
  const email = normalizeEmail(value);
  if (!looksLikeEmail(email) || !isAllowedEmailProvider(email)) return '';
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (GMAIL.has(domain)) {
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return `${local.split('+')[0]}@proton.me`;
}

function looksLikeEmail(email: string): boolean {
  if (email.length < 6 || email.length > 80) return false;
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email);
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return looksLikeEmail(email) && Boolean(canonicalEmail(email));
}
