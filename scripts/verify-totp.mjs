import { createHmac, randomBytes } from 'crypto';
import { totpAt, verifyTotp, bytesToBase32 } from '../utils/totp.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(bytes) {
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

function nodeTotp(secretBytes, atMs) {
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(counter, 4);
  const hash = createHmac('sha1', Buffer.from(secretBytes)).update(msg).digest();
  const offset = hash[19] & 0x0f;
  const bin =
    ((hash[offset] & 0x7f) << 24) |
    (hash[offset + 1] << 16) |
    (hash[offset + 2] << 8) |
    hash[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

const secretBytes = randomBytes(20);
const secret = bytesToBase32(secretBytes);
if (secret !== toBase32(secretBytes)) {
  throw new Error(`base32 mismatch ${secret} vs ${toBase32(secretBytes)}`);
}
const now = Date.now();
const expected = nodeTotp(secretBytes, now);
const got = totpAt(secret, now);
if (expected !== got) {
  throw new Error(`totp mismatch expected=${expected} got=${got}`);
}
if (!verifyTotp(secret, expected, now)) {
  throw new Error('verify failed for current window');
}
console.log('totp ok', expected);
