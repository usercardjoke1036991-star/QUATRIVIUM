const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { getAddress } = require('ethers');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function hexToBytes(address) {
  const hex = address.slice(2).toLowerCase();
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeBase32(bytes) {
  let bits = '';
  for (const value of bytes) bits += value.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += ALPHABET[Number.parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function normalizeCode(raw) {
  return raw
    .toUpperCase()
    .replace(/^BIT-?/, '')
    .replace(/^BC-?/, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, '');
}

function bytesToAddress(bytes) {
  if (bytes.length < 20) return null;
  let hex = '0x';
  for (let i = 0; i < 20; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  try {
    return getAddress(hex);
  } catch {
    return null;
  }
}

function decodeBase32(normalized) {
  if (normalized.length !== 32) return null;
  let bits = '';
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

function formatInviteCode(compact) {
  const clean = normalizeCode(compact);
  if (clean.length !== 32) return compact;
  return clean.match(/.{1,4}/g)?.join('-') ?? clean;
}

function addressToInviteCode(address) {
  return formatInviteCode(encodeBase32(hexToBytes(getAddress(address))));
}

function inviteCodeToAddress(code) {
  const bytes = decodeBase32(normalizeCode(code));
  if (!bytes) return null;
  return bytesToAddress(bytes);
}

function parseInviteInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    return getAddress(trimmed);
  } catch {
    // not an address
  }
  if (trimmed.includes('://')) {
    const query = trimmed.split('?')[1] || '';
    const params = new URLSearchParams(query);
    const value = String(params.get('c') || params.get('code') || params.get('ref') || '').trim();
    if (value) return inviteCodeToAddress(value);
  }
  return inviteCodeToAddress(trimmed);
}

describe('invite code and link', function () {
  const wallet = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';
  const grouped = addressToInviteCode(wallet);
  const compact = normalizeCode(grouped);
  const spaced = grouped.replace(/-/g, ' ');

  it('accepts dashes, spaces and the invite URL as the same sponsor', function () {
    expect(grouped).to.match(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(parseInviteInput(grouped)).to.equal(getAddress(wallet));
    expect(parseInviteInput(spaced)).to.equal(getAddress(wallet));
    expect(parseInviteInput(`  ${spaced}  `)).to.equal(getAddress(wallet));
    expect(parseInviteInput(compact)).to.equal(getAddress(wallet));
    expect(parseInviteInput(`quatrivium://invite?c=${compact}`)).to.equal(getAddress(wallet));
    expect(parseInviteInput(`https://quatriviumcredit.app/invite?c=${compact}`)).to.equal(
      getAddress(wallet)
    );
  });

  it('keeps the public HTTPS invite and a copyable card in the network screen', function () {
    const codec = fs.readFileSync(path.join(__dirname, '..', 'utils', 'inviteCode.ts'), 'utf8');
    const ui = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ReferralSection.tsx'),
      'utf8'
    );
    const onboarding = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AccountOnboarding.tsx'),
      'utf8'
    );
    expect(codec).to.include('INVITE_WEB_BASE');
    expect(codec).to.include('/invite?c=');
    expect(codec).to.include('://invite?c=');
    expect(codec).to.include('inviteLinkPreview');
    expect(codec).to.include('parseInviteInput');
    expect(codec).to.include('extractInviteFromUrl');
    expect(codec).to.include('extractInviteFromText');
    expect(ui).to.include('refreshDirectory([padre])');
    expect(ui).to.include('publicView');
    expect(ui).to.include('inviteLinkLabel');
    expect(ui).to.include('copyInviteLink');
    expect(ui).to.include('inviteLinkPreview');
    expect(onboarding).to.include('onEndEditing');
    expect(onboarding).to.include('resolveSponsorInput');
  });
});
