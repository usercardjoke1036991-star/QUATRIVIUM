const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const { getAddress } = require('ethers');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function hexToBytes(address) {
  const hex = address.slice(2).toLowerCase();
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeBase32(bytes) {
  let bits = '';
  for (const value of bytes) bits += value.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function formatInviteCode(compact) {
  return compact.match(/.{1,4}/g).join('-');
}

function addressToInviteCode(address) {
  return formatInviteCode(encodeBase32(hexToBytes(getAddress(address))));
}

function resolveSponsorInput(raw, selfWallet = '') {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { ok: true, code: '', padre: '' };
  if (trimmed === 'nope') return { ok: false, reason: 'invalid' };
  let padre = '';
  try {
    padre = getAddress(trimmed);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (selfWallet && padre.toLowerCase() === selfWallet.toLowerCase()) {
    return { ok: false, reason: 'self' };
  }
  return { ok: true, code: addressToInviteCode(padre), padre };
}

function keepFirstLock(existing, next) {
  return existing || next;
}

describe('sponsor lock at signup', function () {
  const self = '0x1111111111111111111111111111111111111111';
  const padre = '0x2222222222222222222222222222222222222222';

  it('empty input starts a new chain under the founder', function () {
    expect(resolveSponsorInput('', self)).to.deep.equal({ ok: true, code: '', padre: '' });
    expect(resolveSponsorInput('   ', self)).to.deep.equal({ ok: true, code: '', padre: '' });
  });

  it('rejects invalid and self codes before lock', function () {
    expect(resolveSponsorInput('nope', self).ok).to.equal(false);
    expect(resolveSponsorInput(self, self)).to.deep.equal({ ok: false, reason: 'self' });
  });

  it('locks the first sponsor forever', function () {
    const first = {
      v: 1,
      at: '2026-09-16T00:00:00.000Z',
      code: addressToInviteCode(padre),
      padre: getAddress(padre),
    };
    const later = { v: 1, at: '2026-09-17T00:00:00.000Z', code: '', padre: '' };
    expect(keepFirstLock(null, first)).to.deep.equal(first);
    expect(keepFirstLock(first, later)).to.deep.equal(first);
  });

  it('puts the optional code only on create account, not on credit activation', function () {
    const onboarding = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AccountOnboarding.tsx'),
      'utf8'
    );
    const activate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'ActivateCreditSection.tsx'),
      'utf8'
    );
    const handlers = fs.readFileSync(
      path.join(__dirname, '..', 'hooks', 'useHomeHandlers.ts'),
      'utf8'
    );
    const lock = fs.readFileSync(path.join(__dirname, '..', 'utils', 'sponsorLock.ts'), 'utf8');
    expect(onboarding).to.include(
      'const askSponsor = !isRegistered && !sponsorLocked && registrationKnown'
    );
    expect(onboarding).to.include('signupInviteLead');
    expect(onboarding).to.include('lockSponsorOnce');
    expect(onboarding).to.match(
      /beforeClaim=\{async \(\) => \{[\s\S]*lockSponsorOnce\(walletAddress, inviteDraft, true\)/
    );
    const gate = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AppLockGate.tsx'),
      'utf8'
    );
    expect(gate).to.include('signupInviteLabel');
    expect(gate).to.include('lockSponsorOnce(wallet.address, inviteDraft, true)');
    expect(onboarding).to.not.include("lockSponsorOnce(walletAddress, '')");
    expect(activate).to.not.include('invitePlaceholder');
    expect(activate).to.not.include('initialInviteCode');
    expect(handlers).to.include('lockSponsorOnce');
    expect(handlers).to.match(/const handleRegistrarHumano = async \(\) =>/);
    expect(lock).to.include('keepFirstLock');
    expect(lock).to.include('parseInviteInput');
  });
});
