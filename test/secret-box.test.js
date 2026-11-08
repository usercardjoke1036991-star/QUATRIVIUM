const { expect } = require('chai');
const { concat, getBytes, hexlify, randomBytes, sha256, toUtf8Bytes } = require('ethers');
const { sealAesGcmV2, openAesGcmV2 } = require('../utils/secretBoxAes');

function hmacSha256(key, data) {
  const block = 64;
  let keyBytes = getBytes(key);
  if (keyBytes.length > block) keyBytes = getBytes(sha256(keyBytes));
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

function deriveWrapKey(secret, salt, rounds) {
  let digest = sha256(toUtf8Bytes(`quatrivium.wrap.v1:${salt}:${secret}`));
  for (let i = 1; i < rounds; i += 1) {
    digest = sha256(concat([getBytes(digest), toUtf8Bytes(`:${i}`)]));
  }
  return digest;
}

function keystream(key, iv, length) {
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

function openSecretV1(blob, wrapKeyHex) {
  const parsed = JSON.parse(blob);
  const key = getBytes(wrapKeyHex);
  const macKey = hmacSha256(key, toUtf8Bytes('quatrivium.mac.v1'));
  const iv = getBytes(parsed.iv);
  const ct = getBytes(parsed.ct);
  const mac = getBytes(parsed.mac);
  const expected = hmacSha256(macKey, getBytes(concat([iv, ct])));
  let diff = 0;
  for (let i = 0; i < mac.length; i += 1) diff |= mac[i] ^ expected[i];
  if (mac.length !== expected.length || diff !== 0) throw new Error('mac');
  const ks = keystream(key, iv, ct.length);
  const plain = new Uint8Array(ct.length);
  for (let i = 0; i < ct.length; i += 1) plain[i] = ct[i] ^ ks[i];
  return Buffer.from(plain).toString('utf8');
}

function sealSecretV1(plaintext, wrapKeyHex) {
  const key = getBytes(wrapKeyHex);
  const macKey = hmacSha256(key, toUtf8Bytes('quatrivium.mac.v1'));
  const iv = randomBytes(16);
  const plain = toUtf8Bytes(plaintext);
  const ks = keystream(key, iv, plain.length);
  const ct = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i += 1) ct[i] = plain[i] ^ ks[i];
  const mac = hmacSha256(macKey, getBytes(concat([iv, ct])));
  return JSON.stringify({ v: 1, iv: hexlify(iv), ct: hexlify(ct), mac: hexlify(mac) });
}

describe('secret box AES-GCM v2', function () {
  it('writes v2 and still opens a v1 envelope', function () {
    const wrap = deriveWrapKey('847291', 'salt-a', 32);
    const other = deriveWrapKey('847292', 'salt-a', 32);
    const payload = JSON.stringify({ privateKey: '0xabc', mnemonic: 'alpha beta' });
    const v2 = sealAesGcmV2(payload, wrap);
    const parsed = JSON.parse(v2);
    expect(parsed.v).to.equal(2);
    expect(openAesGcmV2(parsed, wrap)).to.equal(payload);
    expect(() => openAesGcmV2(parsed, other)).to.throw('mac');

    const v1 = sealSecretV1(payload, wrap);
    expect(JSON.parse(v1).v).to.equal(1);
    expect(openSecretV1(v1, wrap)).to.equal(payload);
  });
});
