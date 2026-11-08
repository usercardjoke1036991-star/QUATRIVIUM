import { Wallet, getBytes, Signature, verifyMessage } from 'ethers';

export function sameHexKey(a, b) {
  const n = (value) =>
    String(value || '')
      .replace(/^0x/i, '')
      .toLowerCase();
  return Boolean(a) && Boolean(b) && n(a) === n(b) && n(a).length >= 64;
}

export function requireDistinctAttesterKeys(attesterKey, cosignKey) {
  if (!attesterKey || !cosignKey) return 'missing';
  if (sameHexKey(attesterKey, cosignKey)) return 'same';
  try {
    const a = new Wallet(attesterKey).address;
    const b = new Wallet(cosignKey).address;
    if (a.toLowerCase() === b.toLowerCase()) return 'same';
  } catch {
    return 'bad';
  }
  return '';
}

export async function cosignPacked(cosignKey, packed) {
  const wallet = new Wallet(cosignKey);
  const signature = await wallet.signMessage(getBytes(packed));
  const parsed = Signature.from(signature);
  return { address: wallet.address, signature, v: parsed.v, r: parsed.r, s: parsed.s };
}

export function verifyCosign(packed, signature, expected) {
  try {
    return (
      verifyMessage(getBytes(packed), signature).toLowerCase() ===
      String(expected || '').toLowerCase()
    );
  } catch {
    return false;
  }
}
