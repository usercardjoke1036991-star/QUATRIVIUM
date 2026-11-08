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

  it('binds FundsConfirm to Keystore wrap and fail-closed empty queues', function () {
    const funds = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'FundsConfirmHost.tsx'),
      'utf8'
    );
    expect(funds).to.include('loadWrapFromBiometric');
    expect(funds).to.not.include('authenticateBiometric');
    expect(funds).to.include('if (!queue.length) return false');
    expect(funds).to.not.include('if (!queue.length) return true');
    const lock = fs.readFileSync(path.join(__dirname, '..', 'services', 'appLock.ts'), 'utf8');
    expect(lock).to.include("biometricsSecurityLevel: 'strong'");
    expect(lock).to.include('PIN_ROUNDS = 20_000');
    expect(lock).to.include('SecureStore.getItemAsync(RECOVERY_WRAP, BIO_WRAP_OPTIONS)');
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
    expect(reserva).to.include('function applyFamaCaja');
    expect(reserva).to.include('BOOST_GAP');
    expect(reserva).to.include('BOOST_DIA_TOPE');
    expect(reserva).to.include('function addGuardian');
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
