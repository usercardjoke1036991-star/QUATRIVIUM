const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_CHARS = /[<>`"\\]/g;

export function stripUnsafeText(value: string, max = 64): string {
  return String(value || '')
    .replace(CONTROL_CHARS, '')
    .replace(HTML_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

export function isAllowedWei(amountWei: string, maxWei = 10n ** 27n): boolean {
  try {
    const value = BigInt(amountWei);
    return value > 0n && value <= maxWei;
  } catch {
    return false;
  }
}

export function isHexAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
