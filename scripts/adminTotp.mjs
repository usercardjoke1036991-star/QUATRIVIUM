/** TOTP de admin atado a la billetera. La semilla no se imprime ni va a git. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function bytesToBase32(bytes) {
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

export function generateAdminTotpSecret() {
  return bytesToBase32(randomBytes(20));
}

function sanitizeBase32(secret) {
  const raw = String(secret || '').toUpperCase();
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 61) end -= 1;
  let clean = '';
  for (let i = 0; i < end; i += 1) {
    const char = raw[i];
    if ((char >= 'A' && char <= 'Z') || (char >= '2' && char <= '7')) clean += char;
  }
  return clean;
}

function base32ToBytes(secret) {
  const clean = sanitizeBase32(secret);
  let bits = 0;
  let value = 0;
  const out = [];
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
  return Buffer.from(out);
}

export function totpAt(secret, atMs = Date.now()) {
  const key = base32ToBytes(secret);
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(counter >>> 0, 4);
  const hash = createHmac('sha1', key).update(msg).digest();
  const offset = hash[19] & 0x0f;
  const bin =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

export function verifyAdminTotp(secret, code, atMs = Date.now()) {
  const trimmed = String(code || '').replace(/\D/g, '');
  if (trimmed.length !== 6 || !secret) return false;
  const expected = Buffer.from(trimmed, 'utf8');
  for (const step of [-1, 0, 1]) {
    const got = Buffer.from(totpAt(secret, atMs + step * 30_000), 'utf8');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}

export function adminTotpUrl(secret, account) {
  const label = encodeURIComponent(`Quatrivium:${account || 'admin'}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Quatrivium&digits=6&period=30`;
}
