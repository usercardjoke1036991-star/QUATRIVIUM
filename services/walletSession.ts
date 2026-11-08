let wrapKey: string | null = null;

export function setWalletWrapKey(key: string | null): void {
  if (!key) {
    wrapKey = null;
    return;
  }
  const normalized = (key.startsWith('0x') ? key : `0x${key}`).toLowerCase();
  wrapKey = /^0x[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

export function getWalletWrapKey(): string | null {
  return wrapKey;
}

export function hasWalletSession(): boolean {
  return Boolean(wrapKey);
}

export function clearWalletSession(): void {
  wrapKey = null;
}
