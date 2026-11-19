const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

async function advance(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine');
}

async function borrowAndPay(contract, user, tokenAddr) {
  await advance(48 * 60 * 60);
  await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
  const debt = await contract.obtenerDeuda(user.address);
  await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
  return debt.total;
}

describe('QuatriviumFamaCaja - racha diaria', function () {
  it('exposes streak fame and milestone bonuses', async () => {
    const { fama } = await deployProtocol();
    expect(await fama.FAMA_POR_DIA_RACHA()).to.equal(100n);
    expect(await fama.RACHA_GRACIA_DIAS()).to.equal(1n);
    expect(await fama.bonoDeHitoRacha(7)).to.equal(ethers.parseUnits('5', 18));
    expect(await fama.bonoDeHitoRacha(30)).to.equal(ethers.parseUnits('25', 18));
    expect(await fama.bonoDeHitoRacha(100)).to.equal(ethers.parseUnits('100', 18));
    expect(await fama.bonoDeHitoRacha(365)).to.equal(ethers.parseUnits('500', 18));
    expect(await fama.siguienteHitoRacha(0)).to.equal(7n);
    expect(await fama.siguienteHitoRacha(7)).to.equal(30n);
    expect(await fama.siguienteHitoRacha(100)).to.equal(365n);
  });

  it('adds a ranking day and 100 fame when a referred user pays and notifies', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      extra: padre,
      tokenAddr,
      signers,
    } = await deployProtocol({ harness: true });
    const hijo = signers[3];
    await seedPool(token, contract, owner, '500');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, hijo, '20', padre.address);
    await contract.forceNivel(hijo.address, 2);
    await borrowAndPay(contract, hijo, tokenAddr);
    await fama.connect(hijo).notificarRacha(hijo.address);

    const row = await fama.obtenerRacha(padre.address);
    expect(row.dias).to.equal(1);
    expect(row.diasMax).to.equal(1);
    expect(row.famaDias).to.equal(1);
    expect(await fama.famaRacha(padre.address)).to.equal(100n);
    expect(await fama.famaCaja(padre.address)).to.equal(0n);
  });

  it('does not add two ranking days on the same calendar day', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      extra: padre,
      tokenAddr,
      signers,
    } = await deployProtocol({ harness: true });
    const hijoA = signers[3];
    const hijoB = signers[4];
    await seedPool(token, contract, owner, '500');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, hijoA, '20', padre.address);
    await registerAndFund(token, contract, hijoB, '20', padre.address);
    await contract.forceNivel(hijoA.address, 2);
    await contract.forceNivel(hijoB.address, 2);
    await borrowAndPay(contract, hijoA, tokenAddr);
    await fama.connect(hijoA).notificarRacha(hijoA.address);
    await contract.connect(hijoB).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(hijoB.address);
    await contract.connect(hijoB).pagarPrestamo(tokenAddr, debt.total);
    await fama.connect(hijoB).notificarRacha(hijoB.address);
    expect((await fama.obtenerRacha(padre.address)).dias).to.equal(1);
    expect((await fama.obtenerRacha(padre.address)).famaDias).to.equal(1);
  });

  it('keeps the streak through one grace day and decays ranking, not fame, after that', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      extra: padre,
      tokenAddr,
      signers,
    } = await deployProtocol({ harness: true });
    const hijo = signers[3];
    await seedPool(token, contract, owner, '500');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, hijo, '40', padre.address);
    await contract.forceNivel(hijo.address, 2);
    await borrowAndPay(contract, hijo, tokenAddr);
    await fama.connect(hijo).notificarRacha(hijo.address);
    await borrowAndPay(contract, hijo, tokenAddr);
    await fama.connect(hijo).notificarRacha(hijo.address);
    expect((await fama.obtenerRacha(padre.address)).dias).to.equal(2);
    expect((await fama.obtenerRacha(padre.address)).famaDias).to.equal(2);

    await advance(4 * 24 * 60 * 60);
    const faded = await fama.obtenerRacha(padre.address);
    expect(faded.dias).to.equal(0);
    expect(faded.famaDias).to.equal(2);
    expect(await fama.famaRacha(padre.address)).to.equal(200n);
    expect(await fama.famaCaja(padre.address)).to.equal(0n);
  });

  it('lets the padrino accumulate and claim the 7-day streak bonus from the pool', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      extra: padre,
      tokenAddr,
      signers,
    } = await deployProtocol({ harness: true });
    const hijo = signers[3];
    await seedPool(token, contract, owner, '500');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, hijo, '80', padre.address);
    await contract.forceNivel(hijo.address, 2);
    for (let i = 0; i < 7; i += 1) {
      await borrowAndPay(contract, hijo, tokenAddr);
      await fama.connect(hijo).notificarRacha(hijo.address);
    }
    const row = await fama.obtenerRacha(padre.address);
    expect(row.dias).to.equal(7);
    expect(row.diasMax).to.equal(7);
    expect(row.bonoPendiente).to.equal(ethers.parseUnits('5', 18));

    const alta = await ethers.getContractAt('QuatriviumAlta', await fama.alta());
    await token.mint(padre.address, ethers.parseUnits('10', 18));
    await token.connect(padre).approve(await alta.getAddress(), ethers.MaxUint256);
    await token.connect(padre).approve(await contract.getAddress(), ethers.MaxUint256);
    await alta.connect(padre).pagarRegistro();
    await contract.connect(padre).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(padre)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(padre.address)).total);
    const before = await token.balanceOf(padre.address);
    await fama.connect(padre).cobrarBonoRacha();
    expect(await token.balanceOf(padre.address)).to.equal(before + ethers.parseUnits('5', 18));
    expect((await fama.obtenerRacha(padre.address)).hitoCobrado).to.equal(7);
    expect((await fama.obtenerRacha(padre.address)).bonoPendiente).to.equal(0n);
  });
});
