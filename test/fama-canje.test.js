const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  deployProtocol,
  seedPool,
  registerAndFund,
  qualifyCollector,
  proposeAndExecute,
  assertNavInvariant,
  expectAmt,
  drainToken,
} = require('./helpers.cjs');

async function advanceCooldown() {
  await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
  await ethers.provider.send('evm_mine');
}

async function borrowAndPay(contract, user, tokenAddr) {
  await advanceCooldown();
  await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
  const debt = await contract.obtenerDeuda(user.address);
  await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
}

describe('QuatriviumFamaCaja - fama de caja y canje', function () {
  it('exposes the agreed fame and redeem rates', async () => {
    const { contract, fama } = await deployProtocol();
    expect(await contract.BONO_ACTIVACION()).to.equal(ethers.parseUnits('1', 18));
    expect(await fama.FAMA_POR_USDT()).to.equal(100n);
    expect(await fama.FAMA_POR_REFERIDO_L1()).to.equal(100n);
    expect(await fama.FAMA_CANJE_POR_USDT()).to.equal(250n);
    expect(await contract.famaHermano()).to.equal(await fama.getAddress());
  });

  it('does not walk fame up the line on signup', async () => {
    const { contract, fama, owner, extra: a, signers } = await deployProtocol();
    const b = signers[3];
    await contract.connect(a).registrarHumanoConPadre(ethers.ZeroAddress);
    await contract.connect(b).registrarHumanoConPadre(a.address);
    expect(await contract.reputacion(a.address)).to.equal(100n);
    expect(await contract.reputacion(b.address)).to.equal(100n);
    expect(await contract.reputacion(owner.address)).to.equal(100n);
    expect(await fama.famaCaja(a.address)).to.equal(0n);
    expect(await fama.famaCaja(b.address)).to.equal(0n);
  });

  it('credits no caja fame to the direct padrino on the first paid L1', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      extra: padre,
      tokenAddr,
      contractAddr,
      signers,
    } = await deployProtocol();
    const hijo = signers[3];
    const abuelo = signers[4];
    await seedPool(token, contract, owner, '500');
    await contract.connect(abuelo).registrarHumanoConPadre(ethers.ZeroAddress);
    await contract.connect(padre).registrarHumanoConPadre(abuelo.address);
    await qualifyCollector(token, contract, abuelo);
    await qualifyCollector(token, contract, padre);
    await registerAndFund(token, contract, hijo, '20', padre.address);

    expect(await fama.famaCaja(padre.address)).to.equal(0n);
    await contract.connect(hijo).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(hijo.address);
    const founderFame0 = await fama.famaRed(owner.address);
    await contract.connect(hijo).pagarPrestamo(tokenAddr, debt.total);

    expect(await fama.famaCaja(padre.address)).to.equal(0n);
    expect(await fama.famaRed(padre.address)).to.equal(0n);
    expect(await fama.famaCanjeada(padre.address)).to.equal(0n);
    expectAmt(await fama.famaRed(abuelo.address), 53n);
    expectAmt((await fama.famaRed(owner.address)) - founderFame0, 140n);
    expect(await contract.reputacion(padre.address)).to.equal(300n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('lets any level redeem 250 available fame for 1 USDT from the pool', async () => {
    const { token, contract, fama, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '20');
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(user)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(user.address)).total);

    const gift = ethers.parseUnits('5', 18);
    await contract.connect(user).donar(tokenAddr, gift);
    expect(await fama.famaCaja(user.address)).to.equal(500n);
    expect(await fama.famaCanjeada(user.address)).to.equal(0n);

    const beforeBal = await token.balanceOf(user.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    await expect(fama.connect(user).canjearFama(250n))
      .to.emit(fama, 'FamaCanjeada')
      .withArgs(user.address, 250n, ethers.parseUnits('1', 18), tokenAddr);

    expect(await fama.famaCaja(user.address)).to.equal(500n);
    expect(await fama.famaCanjeada(user.address)).to.equal(250n);
    expect(await fama.famaDisponible(user.address)).to.equal(250n);
    expectAmt((await token.balanceOf(user.address)) - beforeBal, ethers.parseUnits('1', 18));
    expectAmt(liqBefore - (await contract.totalLiquidity(tokenAddr)), ethers.parseUnits('1', 18));
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('rejects a redeem that is not a multiple of 250 or bigger than available fame', async () => {
    const { token, contract, fama, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '20');
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('5', 18));
    await expect(fama.connect(user).canjearFama(100n)).to.be.reverted;
    await expect(fama.connect(user).canjearFama(750n)).to.be.reverted;
  });

  it('keeps the 20% cash floor on fame redeem', async () => {
    const { token, contract, fama, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '1');
    await registerAndFund(token, contract, user, '20');
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('5', 18));
    await expect(fama.connect(user).canjearFama(250n)).to.be.reverted;
  });

  it('rejects founder self-donate so fame cannot be printed against the pool', async () => {
    const { token, contract, owner, tokenAddr, contractAddr } = await deployProtocol();
    await token.mint(owner.address, ethers.parseUnits('5', 18));
    await token.connect(owner).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(owner).donar(tokenAddr, ethers.parseUnits('5', 18))).to.be
      .reverted;
  });

  it('rejects pagarCanje from anyone but the fame sibling', async () => {
    const { contract, user, tokenAddr } = await deployProtocol();
    await expect(
      contract.connect(user).pagarCanje(tokenAddr, user.address, ethers.parseUnits('1', 18))
    ).to.be.reverted;
  });

  it('blocks redeem while the loan is overdue or in mora', async () => {
    const { token, contract, fama, owner, extra, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '20');
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('5', 18));
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');
    await expect(fama.connect(user).canjearFama(250n)).to.be.reverted;

    await drainToken(token, user, extra);
    await contract.marcarMorosoSiVencido(user.address);
    expect(await contract.esMoroso(user.address)).to.equal(true);
    await expect(fama.connect(user).canjearFama(250n)).to.be.reverted;
  });

  it('still allows fame redeem if an installment date passed but the loan is not due', async () => {
    const { token, contract, fama, owner, user, tokenAddr, contractAddr } = await deployProtocol({
      harness: true,
    });
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '200');
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('5', 18));

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const first = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, first.total);
    await borrowAndPay(contract, user, tokenAddr);
    await borrowAndPay(contract, user, tokenAddr);

    await contract.forceNivel(user.address, 7);
    await advanceCooldown();

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const plan = await contract.planPago(user.address);
    const info = await contract.usuarios(user.address);
    expect(plan.totales).to.equal(2);
    expect(plan.venceCuota).to.be.lt(info.vencimiento);

    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(plan.venceCuota) + 10]);
    await ethers.provider.send('evm_mine');
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    expect(now).to.be.lt(Number(info.vencimiento));
    await expect(fama.connect(user).canjearFama(250n)).to.emit(fama, 'FamaCanjeada');
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('credits 100 fame per donated USDT from the first', async () => {
    const { token, contract, fama, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user, '20');
    const gift = ethers.parseUnits('2', 18);
    await token.mint(user.address, gift);
    await token.connect(user).approve(contractAddr, gift);
    await contract.connect(user).donar(tokenAddr, gift);
    expect(await contract.donado(user.address)).to.equal(gift);
    expect(await fama.famaCaja(user.address)).to.equal(200n);
  });

  it('credits 100 fame on the first full USDT even after dust', async () => {
    const { token, contract, fama, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user, '20');
    await token.mint(user.address, ethers.parseUnits('3', 18));
    await token.connect(user).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(user).donar(tokenAddr, 1n);
    expect(await fama.famaCaja(user.address)).to.equal(0n);
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('1', 18));
    expect(await fama.famaCaja(user.address)).to.equal(100n);
    await contract.connect(user).donar(tokenAddr, ethers.parseUnits('2', 18));
    expect(await fama.famaCaja(user.address)).to.equal(300n);
  });

  it('sends verification fees to the pool without fame', async () => {
    const { token, contract, fama, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user, '20');
    const fee = ethers.parseUnits('0.5', 18);
    await token.mint(user.address, fee);
    await token.connect(user).approve(contractAddr, fee);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    await expect(contract.connect(user).pagarVerificacion(tokenAddr, fee)).to.be.reverted;
    expect(await contract.totalLiquidity(tokenAddr)).to.equal(liqBefore);
    expect(await fama.famaCaja(user.address)).to.equal(0n);
    expect(await contract.donado(user.address)).to.equal(0n);
  });
});
