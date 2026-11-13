const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, assertNavInvariant } = require('./helpers.cjs');

function requiredCountPlanned(id) {
  if (id < 1 || id > 1000) return 0;
  if (id <= 1) return 3;
  if (id < 10) return 5;
  return 5 * (id - 9);
}

const HITO_USDT = {
  100: 400,
  200: 4000,
  300: 7000,
  400: 8500,
  500: 9000,
  600: 11500,
  700: 13500,
  800: 16000,
  900: 18000,
  1000: 20000,
};

function bonusOf(level) {
  return ethers.parseUnits(String(HITO_USDT[level] || 0), 18);
}

async function deployHarness() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user = signers[1];
  const Token = await ethers.getContractFactory('ERC20Mock');
  const { getLinkedCreditFactory } = require('../scripts/linkCredit.cjs');
  const { deployFamaAndCredit } = require('./helpers.cjs');
  const Harness = await getLinkedCreditFactory(ethers, 'QuatriviumCreditHarness');
  const token = await Token.deploy();
  const tokenAddr = await token.getAddress();
  const { contract, fama } = await deployFamaAndCredit(
    Harness,
    tokenAddr,
    owner,
    500,
    [owner.address, user.address, signers[2].address],
    1
  );
  const contractAddr = await contract.getAddress();
  return { token, contract, fama, owner, user, tokenAddr, contractAddr };
}

describe('QuatriviumLeveling - hermano de solicitudes', function () {
  it('adds 5 required loans per level after $100', async () => {
    const Factory = await ethers.getContractFactory('QuatriviumLeveling');
    const leveling = await Factory.deploy();
    expect(await leveling.requiredCount(1)).to.equal(3n);
    expect(await leveling.requiredCount(9)).to.equal(5n);
    expect(await leveling.requiredCount(10)).to.equal(5n);
    expect(await leveling.requiredCount(11)).to.equal(10n);
    expect(await leveling.requiredCount(100)).to.equal(455n);
    expect(await leveling.requiredCount(101)).to.equal(460n);
    expect(await leveling.requiredCount(999)).to.equal(4950n);
    expect(await leveling.requiredCount(1000)).to.equal(4955n);
    expect(await leveling.bonoDeHito(100)).to.equal(bonusOf(100));
    expect(await leveling.bonoDeHito(200)).to.equal(bonusOf(200));
    expect(await leveling.bonoDeHito(1000)).to.equal(ethers.parseUnits('20000', 18));
    expect(await leveling.BONO_HITOS_TOTAL()).to.equal(ethers.parseUnits('107900', 18));
    for (let id = 1; id <= 1000; id += 17) {
      expect(await leveling.requiredCount(id)).to.equal(BigInt(requiredCountPlanned(id)));
    }
  });

  it('pays a larger bonus at every 100-level milestone', async () => {
    const Factory = await ethers.getContractFactory('QuatriviumLeveling');
    const leveling = await Factory.deploy();
    expect(await leveling.hitoAlcanzado(99)).to.equal(0n);
    expect(await leveling.hitoAlcanzado(100)).to.equal(100n);
    expect(await leveling.hitoAlcanzado(199)).to.equal(100n);
    expect(await leveling.hitoAlcanzado(200)).to.equal(200n);
    expect(await leveling.hitoAlcanzado(1000)).to.equal(1000n);
    expect(await leveling.siguienteHito(0, 99)).to.equal(0n);
    expect(await leveling.siguienteHito(0, 100)).to.equal(100n);
    expect(await leveling.siguienteHito(100, 199)).to.equal(0n);
    expect(await leveling.siguienteHito(100, 200)).to.equal(200n);
    expect(await leveling.siguienteHito(900, 1000)).to.equal(1000n);
    expect(await leveling.siguienteHito(1000, 1000)).to.equal(0n);
    expect(await leveling.DIVISION_SIZE()).to.equal(100n);
    expect(await leveling.L1000_BONO_CADA()).to.equal(100n);
    expect(
      await leveling.presupuestoPremioMensual(
        ethers.parseUnits('400', 18),
        ethers.parseUnits('2000', 18)
      )
    ).to.equal(0n);
    const small = await leveling.presupuestoPremioMensual(
      ethers.parseUnits('2000', 18),
      ethers.parseUnits('2000', 18)
    );
    const large = await leveling.presupuestoPremioMensual(
      ethers.parseUnits('20000', 18),
      ethers.parseUnits('20000', 18)
    );
    expect(small).to.be.gt(0n);
    expect(large).to.be.gt(small);
    expect(await leveling.pesoDivision(1, 2)).to.equal(2n);
    expect(await leveling.pesoDivision(2, 2)).to.equal(1n);
    const caja = ethers.parseUnits('20000', 18);
    const budget = await leveling.presupuestoPremioMensual(caja, caja);
    const sumaPesos = 5050n;
    const firstSeat = await leveling.premioAsiento(caja, caja, 1, 2, 1, sumaPesos);
    expect(firstSeat).to.equal((budget * 2n * 100n) / (3n * sumaPesos));
    const lastSeat = await leveling.premioAsiento(caja, caja, 2, 2, 100, sumaPesos);
    expect(lastSeat).to.equal((budget * 1n * 1n) / (3n * sumaPesos));
    expect(firstSeat).to.be.gt(lastSeat);
  });

  it('keeps the seat prize exact and never pays more than the monthly budget', async () => {
    const Factory = await ethers.getContractFactory('QuatriviumLeveling');
    const leveling = await Factory.deploy();
    const caja = ethers.parseUnits('20000', 18);
    const budget = await leveling.presupuestoPremioMensual(caja, caja);
    const seats = await leveling.DIVISION_SIZE();
    const sumaPesos = (seats * (seats + 1n)) / 2n;

    // El /2 de n(n+1)/2 es exacto: divide-before-multiply no pierde wei.
    for (const divisiones of [1n, 2n, 3n, 7n, 10n]) {
      for (const division of [1n, divisiones]) {
        for (const puesto of [1n, 50n, seats]) {
          const peso = await leveling.pesoDivision(division, divisiones);
          const asiento = seats - puesto + 1n;
          const sinDividirAntes =
            (budget * peso * asiento * 2n) / (divisiones * (divisiones + 1n) * sumaPesos);
          expect(
            await leveling.premioAsiento(caja, caja, division, divisiones, puesto, sumaPesos)
          ).to.equal(sinDividirAntes);
        }
      }
    }

    // Todos los asientos elegibles juntos caben en el bote: el pool no se sobregira.
    for (const divisiones of [1n, 2n, 3n]) {
      let total = 0n;
      for (let division = 1n; division <= divisiones; division += 1n) {
        for (let puesto = 1n; puesto <= seats; puesto += 1n) {
          total += await leveling.premioAsiento(
            caja,
            caja,
            division,
            divisiones,
            puesto,
            sumaPesos
          );
        }
      }
      expect(total).to.be.lte(budget);
    }
  });

  it('only pays a milestone bonus when the pool has free cash above the floor', async () => {
    const Factory = await ethers.getContractFactory('QuatriviumLeveling');
    const leveling = await Factory.deploy();
    expect(await leveling.canPayHito(bonusOf(100), bonusOf(100), 100)).to.equal(false);
    expect(
      await leveling.canPayHito(ethers.parseUnits('3000', 18), ethers.parseUnits('3000', 18), 100)
    ).to.equal(true);
    expect(
      await leveling.canPayMaxBonus(ethers.parseUnits('40000', 18), ethers.parseUnits('40000', 18))
    ).to.equal(true);
  });
});

describe('QuatriviumCredit - bono de hito cada 100 niveles', function () {
  it('rejects a claim before level 100', async () => {
    const { contract, user, token, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, (await ethers.getSigners())[0], '5000');
    await registerAndFund(token, contract, user);
    await expect(contract.connect(user).cobrarBonoHito(tokenAddr)).to.be.revertedWithoutReason();
  });

  it('pays a proportional bonus one milestone at a time from free cash above the floor', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployHarness();
    await seedPool(token, contract, owner, '8000');
    await token.mint(owner.address, ethers.parseUnits('80000', 18));
    await contract.connect(owner).depositarLiquidez(tokenAddr, ethers.parseUnits('60000', 18));
    await registerAndFund(token, contract, user);
    await contract.forceNivel(user.address, 200);

    const before = await token.balanceOf(user.address);
    await expect(contract.connect(user).cobrarBonoHito(tokenAddr))
      .to.emit(contract, 'BonoHitoPagado')
      .withArgs(user.address, 100n, bonusOf(100), tokenAddr);
    expect(await contract.hitoCobrado(user.address)).to.equal(100n);
    expect(await token.balanceOf(user.address)).to.equal(before + bonusOf(100));
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);

    await expect(contract.connect(user).cobrarBonoHito(tokenAddr))
      .to.emit(contract, 'BonoHitoPagado')
      .withArgs(user.address, 200n, bonusOf(200), tokenAddr);
    expect(await contract.hitoCobrado(user.address)).to.equal(200n);
    await expect(contract.connect(user).cobrarBonoHito(tokenAddr)).to.be.revertedWithoutReason();
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('locks the milestone bonus when free cash is below the 20% floor', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '300');
    await registerAndFund(token, contract, user);
    await contract.forceNivel(user.address, 100);
    await expect(contract.connect(user).cobrarBonoHito(tokenAddr)).to.be.revertedWithoutReason();
    expect(await contract.hitoCobrado(user.address)).to.equal(0n);
  });

  it('lets the max-level bonus be claimed again every 100 on-time loans without resetting the count', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployHarness();
    await seedPool(token, contract, owner, '8000');
    await token.mint(owner.address, ethers.parseUnits('150000', 18));
    await contract.connect(owner).depositarLiquidez(tokenAddr, ethers.parseUnits('120000', 18));
    await registerAndFund(token, contract, user);
    await contract.forceNivel(user.address, 1000);
    await contract.forceHito(user.address, 900);
    await expect(contract.connect(user).cobrarBonoHito(tokenAddr))
      .to.emit(contract, 'BonoHitoPagado')
      .withArgs(user.address, 1000n, bonusOf(1000), tokenAddr);
    expect(await contract.hitoCobrado(user.address)).to.equal(1000n);

    const [monto] = await contract.niveles(1000);
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    await contract.forceSolicitudes(user.address, 99);
    await contract.forceLoanClock(user.address, monto, now + 3600);
    await contract.forcePagoATiempo(user.address);
    expect(await contract.hitoCobrado(user.address)).to.equal(900n);
    const progress = await contract.obtenerProgresoUsuario(user.address);
    expect(progress[1]).to.equal(100n);

    await expect(contract.connect(user).cobrarBonoHito(tokenAddr))
      .to.emit(contract, 'BonoHitoPagado')
      .withArgs(user.address, 1000n, bonusOf(1000), tokenAddr);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });
});

describe('QuatriviumCredit - donacion al fundador', function () {
  it('sends the gift to the founder and raises donor reputation', async () => {
    const { contract, owner, user, token, tokenAddr } = await deployProtocol();
    await registerAndFund(token, contract, user, '20');
    const gift = ethers.parseUnits('10', 18);
    const beforeFounder = await token.balanceOf(owner.address);
    const beforeRep = await contract.reputacion(user.address);
    await expect(contract.connect(user).donar(tokenAddr, gift))
      .to.emit(contract, 'Donacion')
      .withArgs(user.address, gift, tokenAddr);
    expect(await contract.donado(user.address)).to.equal(gift);
    expect(await token.balanceOf(owner.address)).to.equal(beforeFounder + gift);
    expect(await contract.reputacion(user.address)).to.equal(beforeRep + 1000n);
  });

  it('raises reputation when someone injects the common pool', async () => {
    const { contract, user, token, tokenAddr, contractAddr } = await deployProtocol();
    await registerAndFund(token, contract, user, '40');
    const beforeRep = await contract.reputacion(user.address);
    await contract.connect(user).depositarLiquidez(tokenAddr, ethers.parseUnits('20', 18));
    expect(await contract.reputacion(user.address)).to.equal(beforeRep + 2000n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('scales fame with the donated and pooled amounts', async () => {
    const { contract, user, token, tokenAddr } = await deployProtocol();
    await registerAndFund(token, contract, user, '80');
    const before = await contract.reputacion(user.address);
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('25', 18));
    expect(await contract.reputacion(user.address)).to.equal(before + 2500n);
    await contract.connect(user).depositarLiquidez(tokenAddr, ethers.parseUnits('4', 18));
    expect(await contract.reputacion(user.address)).to.equal(before + 2500n + 400n);
  });
});
