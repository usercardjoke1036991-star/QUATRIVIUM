'use strict';

const { gcm } = require('@noble/ciphers/aes');
const { getBytes, hexlify, randomBytes, toUtf8Bytes, toUtf8String } = require('ethers');

const AES_GCM_AAD = toUtf8Bytes('quatrivium.aesgcm.v2');
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

function sealAesGcmV2(plaintext, wrapKeyHex) {
  const key = getBytes(wrapKeyHex);
  if (key.length !== 32) {
    throw new Error('seal');
  }
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const packed = gcm(key, nonce, AES_GCM_AAD).encrypt(toUtf8Bytes(plaintext));
  const ct = packed.subarray(0, packed.length - GCM_TAG_BYTES);
  const tag = packed.subarray(packed.length - GCM_TAG_BYTES);
  return JSON.stringify({
    v: 2,
    iv: hexlify(nonce),
    ct: hexlify(ct),
    tag: hexlify(tag),
  });
}

function openAesGcmV2(parsed, wrapKeyHex) {
  const key = getBytes(wrapKeyHex);
  if (key.length !== 32) {
    throw new Error('seal');
  }
  const nonce = getBytes(parsed.iv);
  const ct = getBytes(parsed.ct);
  const tag = getBytes(parsed.tag);
  if (nonce.length !== GCM_NONCE_BYTES || tag.length !== GCM_TAG_BYTES) {
    throw new Error('seal');
  }
  const packed = new Uint8Array(ct.length + tag.length);
  packed.set(ct, 0);
  packed.set(tag, ct.length);
  try {
    const plain = gcm(key, nonce, AES_GCM_AAD).decrypt(packed);
    return toUtf8String(plain);
  } catch {
    throw new Error('mac');
  }
}

module.exports = { sealAesGcmV2, openAesGcmV2 };
