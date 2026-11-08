const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, expectAmt } = require('./helpers.cjs');

async function advance(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine');
}

describe('Fase 1 — soberanía de cobros, racha, alta, liquidación y oráculo', function () {
  it('sums milestone bonuses to 107900 LUSD', async () => {
    const Leveling = await ethers.getContractFactory('QuatriviumLeveling');
    const leveling = await Leveling.deploy();
    let sum = 0n;
    for (let h = 100; h <= 1000; h += 100) {
      sum += await leveling.bonoDeHito(h);
    }
    expect(await leveling.BONO_HITOS_TOTAL()).to.equal(sum);
    expect(sum).to.equal(ethers.parseUnits('107900', 18));
  });

  it('drops setNivel, setMorosidad, attester and the price feed', async () => {
    const { contract, reserva } = await deployProtocol();
    for (const name of ['setNivel', 'setMorosidad', 'vincularIdentidad', 'attester', 'assertPeg']) {
      expect(contract.interface.hasFunction(name), name).to.equal(false);
    }
    expect(reserva.interface.hasFunction('pausarBoost')).to.equal(false);
    expect(reserva.interface.hasFunction('setAltaFuente')).to.equal(false);
  });

  it('reverts a loan when Alta was not paid and cannot be skipped', async () => {
    const { contract, user, tokenAddr, owner, token } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
  });

  it('does not farm a streak with a pair of level-1 accounts', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      extra: padre,
      tokenAddr,
      signers,
    } = await deployProtocol({
      harness: true,
    });
    const hijo = signers[3];
    await seedPool(token, contract, owner, '100');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, hijo, '20', padre.address);
    await contract.connect(hijo).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(hijo.address);
    await contract.connect(hijo).pagarPrestamo(tokenAddr, debt.total);
    await expect(fama.connect(hijo).notificarRacha(hijo.address)).to.be.reverted;
    expect((await fama.obtenerRacha(padre.address)).dias).to.equal(0);

    await advance(48 * 60 * 60);
    await contract.forceNivel(hijo.address, 2);
    await contract.connect(hijo).solicitarPrestamo(tokenAddr, 0);
    const debt2 = await contract.obtenerDeuda(hijo.address);
    await contract.connect(hijo).pagarPrestamo(tokenAddr, debt2.total);
    await fama.connect(hijo).notificarRacha(hijo.address);
    expect((await fama.obtenerRacha(padre.address)).dias).to.equal(1);
  });

  it('sends an unilevel share to the pool when the payee has not paid L1', async () => {
    const { token, contract, owner, user, extra: padre, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '100');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, user, '20', padre.address);
    const padreBefore = await token.balanceOf(padre.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    expect(await token.balanceOf(padre.address)).to.equal(padreBefore);
    expect(await contract.totalLiquidity(tokenAddr)).to.be.gt(liqBefore - debt.principal);
  });

  it('sends the sponsor bonus to the pool when the sponsor has not paid L1', async () => {
    const { token, contract, alta, owner, user, extra: padre, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '100');
    await registerAndFund(token, contract, padre, '20');
    await registerAndFund(token, contract, user, '20', padre.address);
    const padreBefore = await token.balanceOf(padre.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    expect(await token.balanceOf(padre.address)).to.equal(padreBefore);
    expectAmt(await alta.padrinoApartado(user.address), 0n);
    expect(await contract.totalLiquidity(tokenAddr)).to.be.gte(liqBefore);
  });

  it('keeps fame redeem and the streak prize in the pool until the collector paid L1', async () => {
    const { token, contract, fama, owner, user, tokenAddr } = await deployProtocol({
      harness: true,
    });
    await seedPool(token, contract, owner, '500');
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    await token.mint(user.address, ethers.parseUnits('20', 18));
    await token.connect(user).approve(await contract.getAddress(), ethers.MaxUint256);
    const alta = await ethers.getContractAt('QuatriviumAlta', await fama.alta());
    await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
    await alta.connect(user).pagarRegistro();
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('5', 18));
    const liq = await contract.totalLiquidity(tokenAddr);
    await expect(fama.connect(user).canjearFama(250n)).to.be.reverted;
    expect(await contract.totalLiquidity(tokenAddr)).to.equal(liq);
    await expect(fama.connect(user).cobrarBonoRacha()).to.be.reverted;
    expect(await contract.totalLiquidity(tokenAddr)).to.equal(liq);
  });

  it('waits 48h after due before liquidation and caps the prize by interest at level 1000', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
    } = await deployProtocol({ harness: true });
    await token.mint(owner.address, ethers.parseUnits('2000000', 18));
    await token.connect(owner).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(owner).depositarLiquidez(tokenAddr, ethers.parseUnits('1510000', 18));
    await registerAndFund(token, contract, user, '20');
    await contract.forceNivel(user.address, 1000);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 1000);
    const info = await contract.usuarios(user.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');
    await token.mint(liquidator.address, ethers.parseUnits('1200000', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.be.reverted;
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(info.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await contract.connect(liquidator).liquidate(user.address, tokenAddr);
    const liqAfter = await contract.totalLiquidity(tokenAddr);
    expect(liqAfter).to.be.gte(liqBefore);
  });
});
