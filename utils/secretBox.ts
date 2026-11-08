import { concat, getBytes, sha256, toUtf8Bytes, toUtf8String, type BytesLike } from 'ethers';
import { openAesGcmV2, sealAesGcmV2 } from './secretBoxAes';
import { storeSlot } from './storeSlot';

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    return timingSafeEqualBytes(
      getBytes(a.startsWith('0x') ? a : `0x${a}`),
      getBytes(b.startsWith('0x') ? b : `0x${b}`)
    );
  } catch {
    return false;
  }
}

export function hmacSha256(key: BytesLike, data: BytesLike): Uint8Array {
  const block = 64;
  let keyBytes = getBytes(key);
  if (keyBytes.length > block) {
    keyBytes = getBytes(sha256(keyBytes));
  }
  const keyBlock = new Uint8Array(block);
  keyBlock.set(keyBytes);
  const ipad = new Uint8Array(block);
  const opad = new Uint8Array(block);
  for (let i = 0; i < block; i += 1) {
    ipad[i] = keyBlock[i] ^ 0x36;
    opad[i] = keyBlock[i] ^ 0x5c;
  }
  const inner = getBytes(sha256(concat([ipad, getBytes(data)])));
  return getBytes(sha256(concat([opad, inner])));
}

export function deriveWrapKey(secret: string, salt: string, rounds: number): string {
  const n = Math.max(1, Math.min(rounds, 20_000));
  let digest = sha256(toUtf8Bytes(`quatrivium.wrap.v1:${salt}:${secret}`));
  for (let i = 1; i < n; i += 1) {
    digest = sha256(concat([getBytes(digest), toUtf8Bytes(`:${i}`)]));
  }
  return digest;
}

/** Misma clave que deriveWrapKey, sin congelar el hilo JS en 8000 vueltas. */
export async function deriveWrapKeyAsync(
  secret: string,
  salt: string,
  rounds: number
): Promise<string> {
  const n = Math.max(1, Math.min(rounds, 20_000));
  let digest = sha256(toUtf8Bytes(`quatrivium.wrap.v1:${salt}:${secret}`));
  for (let i = 1; i < n; i += 1) {
    digest = sha256(concat([getBytes(digest), toUtf8Bytes(`:${i}`)]));
    if (i % 250 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return digest;
}

function keystream(key: Uint8Array, iv: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const ctr = new Uint8Array(4);
    ctr[0] = (counter >>> 24) & 0xff;
    ctr[1] = (counter >>> 16) & 0xff;
    ctr[2] = (counter >>> 8) & 0xff;
    ctr[3] = counter & 0xff;
    const block = getBytes(sha256(concat([key, iv, ctr])));
    const n = Math.min(32, length - offset);
    out.set(block.subarray(0, n), offset);
    offset += n;
    counter += 1;
  }
  return out;
}

export type SealedSecretV1 = {
  v: 1;
  iv: string;
  ct: string;
  mac: string;
};

export type SealedSecretV2 = {
  v: 2;
  iv: string;
  ct: string;
  tag: string;
};

export type SealedSecret = SealedSecretV1 | SealedSecretV2;

export function isSealedBlob(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Partial<SealedSecret>;
    if (parsed.v === 2) {
      return Boolean(parsed.iv && parsed.ct && parsed.tag);
    }
    return parsed.v === 1 && Boolean(parsed.iv && parsed.ct && parsed.mac);
  } catch {
    return false;
  }
}

export function sealedBlobVersion(raw: string): 1 | 2 | 0 {
  try {
    const parsed = JSON.parse(raw) as { v?: number };
    if (parsed.v === 2 || parsed.v === 1) return parsed.v;
  } catch {
    // ignore
  }
  return 0;
}

function openSecretV1(parsed: SealedSecretV1, wrapKeyHex: string): string {
  const key = getBytes(wrapKeyHex);
  const macKey = hmacSha256(key, toUtf8Bytes(storeSlot(['quatrivium', 'mac', 'v1'])));
  const iv = getBytes(parsed.iv);
  const ct = getBytes(parsed.ct);
  const mac = getBytes(parsed.mac);
  const expected = hmacSha256(macKey, getBytes(concat([iv, ct])));
  if (!timingSafeEqualBytes(mac, expected)) {
    throw new Error('mac');
  }
  const ks = keystream(key, iv, ct.length);
  const plain = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i += 1) {
    plain[i] = ct[i] ^ ks[i];
  }
  return toUtf8String(plain);
}

function openSecretV2(parsed: SealedSecretV2, wrapKeyHex: string): string {
  return openAesGcmV2(parsed, wrapKeyHex);
}

/** Cierra el sobre con AES-256-GCM. Las cuentas viejas (v1) se siguen abriendo. */
export function sealSecret(plaintext: string, wrapKeyHex: string): string {
  return sealAesGcmV2(plaintext, wrapKeyHex);
}

export function openSecret(blob: string, wrapKeyHex: string): string {
  const parsed = JSON.parse(blob) as Partial<SealedSecret>;
  if (parsed.v === 2 && parsed.iv && parsed.ct && parsed.tag) {
    return openSecretV2({ v: 2, iv: parsed.iv, ct: parsed.ct, tag: parsed.tag }, wrapKeyHex);
  }
  if (parsed.v === 1 && parsed.iv && parsed.ct && parsed.mac) {
    return openSecretV1({ v: 1, iv: parsed.iv, ct: parsed.ct, mac: parsed.mac }, wrapKeyHex);
  }
  throw new Error('seal');
}
