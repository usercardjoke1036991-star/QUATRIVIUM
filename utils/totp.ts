/** TOTP RFC 6238 (HMAC-SHA1, 30 s, 6 dígitos). Sin dependencias extra. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function sha1(bytes: Uint8Array): Uint8Array {
  const extra = bytes.length % 64;
  const pad = extra < 56 ? 56 - extra : 120 - extra;
  const work = new Uint8Array(bytes.length + pad + 8);
  work.set(bytes);
  work[bytes.length] = 0x80;
  const bitLen = bytes.length * 8;
  const view = new DataView(work.buffer);
  view.setUint32(work.length - 4, bitLen >>> 0);
  view.setUint32(work.length - 8, Math.floor(bitLen / 2 ** 32));

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < work.length; i += 64) {
    for (let j = 0; j < 16; j += 1) w[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 80; j += 1) w[j] = rotr(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 31);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let j = 0; j < 80; j += 1) {
      const f =
        j < 20
          ? (b & c) | (~b & d)
          : j < 40
            ? b ^ c ^ d
            : j < 60
              ? (b & c) | (b & d) | (c & d)
              : b ^ c ^ d;
      const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const temp = (rotr(a, 27) + f + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = rotr(b, 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const result = new DataView(out.buffer);
  result.setUint32(0, h0);
  result.setUint32(4, h1);
  result.setUint32(8, h2);
  result.setUint32(12, h3);
  result.setUint32(16, h4);
  return out;
}

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  const use = key.length > 64 ? sha1(key) : key;
  block.set(use);
  const inner = new Uint8Array(64 + message.length);
  const outerPad = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = block[i] ^ 0x36;
    outerPad[i] = block[i] ^ 0x5c;
  }
  inner.set(message, 64);
  const innerHash = sha1(inner);
  const outer = new Uint8Array(84);
  outer.set(outerPad);
  outer.set(innerHash, 64);
  return sha1(outer);
}

export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32ToBytes(secret: string): Uint8Array {
  let clean = secret.toUpperCase();
  while (clean.endsWith('=')) clean = clean.slice(0, -1);
  clean = clean.replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function totpAt(secret: string, atMs = Date.now()): string {
  const key = base32ToBytes(secret);
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = new Uint8Array(8);
  const view = new DataView(msg.buffer);
  view.setUint32(4, counter >>> 0);
  const hash = hmacSha1(key, msg);
  const offset = hash[19] & 0x0f;
  const bin =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const trimmed = code.replace(/\D/g, '');
  if (trimmed.length !== 6 || !secret) return false;
  for (const step of [-1, 0, 1]) {
    if (totpAt(secret, atMs + step * 30_000) === trimmed) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`Quatrivium:${account || 'cuenta'}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Quatrivium&digits=6&period=30`;
}
