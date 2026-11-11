const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('security audit remediations', function () {
  it('allows direct sovereign donations and borrowing without pause, KYC or phone gates', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await token.mint(user.address, ethers.parseUnits('2', 18));
    await token.connect(user).approve(await contract.getAddress(), ethers.MaxUint256);
    await expect(contract.connect(user).donar(tokenAddr, ethers.parseUnits('2', 18))).to.not.be
      .reverted;
    const fresh = await deployProtocol();
    await seedPool(fresh.token, fresh.contract, fresh.owner, '50');
    await registerAndFund(fresh.token, fresh.contract, fresh.user);
    await expect(fresh.contract.connect(fresh.user).solicitarPrestamo(fresh.tokenAddr, 0)).to.not.be
      .reverted;
  });

  it('has no on-chain destroy so leftover USDT stays in the wallet', async () => {
    const { token, contract, owner, user } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    const before = await token.balanceOf(user.address);
    expect(contract.interface.hasFunction('destruirCuenta')).to.equal(false);
    expect(await token.balanceOf(user.address)).to.equal(before);
  });

  it('elige hardware cuando el dispositivo lo tiene y migra el PIN viejo', async function () {
    require('ts-node/register');
    const {
      wrapStoreMode,
      needsPinUpgrade,
      PIN_PBKDF2_ROUNDS,
      PIN_SPLIT,
      pbkdf2Sha256Hex,
      PIN_KDF,
    } = require('../utils/pinKdf.ts');
    const { lockoutMs, remainingLockMs } = require('../utils/pinPolicy.ts');
    expect(wrapStoreMode(true)).to.equal('hardware');
    expect(wrapStoreMode(false)).to.equal('software');
    expect(needsPinUpgrade({ kdf: 'sha256', rounds: 20_000 })).to.equal(true);
    expect(needsPinUpgrade({ kdf: PIN_KDF, rounds: PIN_PBKDF2_ROUNDS })).to.equal(true);
    expect(needsPinUpgrade({ kdf: PIN_KDF, rounds: PIN_PBKDF2_ROUNDS, split: 1 })).to.equal(true);
    expect(needsPinUpgrade({ kdf: PIN_KDF, rounds: PIN_PBKDF2_ROUNDS, split: PIN_SPLIT })).to.equal(
      true
    );
    expect(
      needsPinUpgrade({ kdf: PIN_KDF, rounds: PIN_PBKDF2_ROUNDS, split: PIN_SPLIT, device: 1 })
    ).to.equal(false);
    expect(
      needsPinUpgrade({ kdf: PIN_KDF, rounds: 600_000, split: PIN_SPLIT, device: 1 })
    ).to.equal(true);
    const hash = await pbkdf2Sha256Hex('847291', 'sal-prueba', 2);
    expect(hash).to.match(/^[0-9a-f]{64}$/);
    const again = await pbkdf2Sha256Hex('847291', 'sal-prueba', 2);
    expect(again).to.equal(hash);
    expect(PIN_PBKDF2_ROUNDS).to.equal(9_000);
    expect(PIN_PBKDF2_ROUNDS).to.be.below(600_000);
    const now = 5_000;
    expect(remainingLockMs(now + lockoutMs(2), now)).to.equal(60_000);
    const funds = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'FundsConfirmHost.tsx'),
      'utf8'
    );
    expect(funds).to.include('if (!queue.length) return false');
    const fama = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'libraries', 'QuatriviumFamaLib.sol'),
      'utf8'
    );
    expect(fama).to.not.include('PEG_MAX_EDAD');
    expect(fama).to.include('function altaRegistrada');
    expect(fama).to.include('_avisarReserva');
    expect(fama).to.not.include('recoverAttest');
    const reserva = fs.readFileSync(
      path.join(__dirname, '..', 'contracts', 'QuatriviumReserva.sol'),
      'utf8'
    );
    expect(reserva).to.include('function boostIdOf');
    expect(reserva).to.not.include('function applyFamaCaja');
    expect(reserva).to.include('BOOST_GAP');
    expect(reserva).to.include('BOOST_DIA_TOPE');
    expect(reserva).to.not.include('function addGuardian');
    expect(reserva).to.include('function proponerAdmin');
    expect(reserva).to.not.include('function proponerRetiroBote');
    expect(reserva).to.not.include('function pausarBoost');
  });

  it('keeps leftover translation scripts free of password-named keys', function () {
    const dir = path.join(__dirname, '..', 'scripts');
    const names = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('patch-i18n-leftovers') && name.endsWith('.mjs'));
    expect(names.length).to.be.at.least(4);
    for (const name of names) {
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      expect(src, name).to.not.match(/^\s*\w*[Pp]assword\w*\s*:/m);
      expect(src, name).to.not.match(/\bpasswordRule/i);
      expect(src, name).to.not.match(/\blockPassword/i);
      expect(src, name).to.not.match(/\bauthenticatorSecret\b/);
    }
    const sonar = fs.readFileSync(path.join(__dirname, '..', '.sonarcloud.properties'), 'utf8');
    expect(sonar).to.include('scripts/patch-i18n-leftovers*.mjs');
  });
});
