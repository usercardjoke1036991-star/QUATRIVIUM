const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  deployProtocol,
  seedPool,
  registerAndFund,
  drainToken,
  attestIdentity,
  expectAmt,
} = require('./helpers.cjs');

async function advanceCooldown() {
  await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
  await ethers.provider.send('evm_mine');
}

async function enableFounderBorrow(token, contract, owner) {
  expect(await contract.humanosVerificados(owner.address)).to.equal(true);
  const fama = await ethers.getContractAt('QuatriviumFamaCaja', await contract.famaHermano());
  const alta = await ethers.getContractAt('QuatriviumAlta', await fama.alta());
  if (await alta.registroHecho(owner.address)) return;
  await token.mint(owner.address, ethers.parseUnits('4', 18));
  await token.connect(owner).approve(await alta.getAddress(), ethers.MaxUint256);
  await alta.connect(owner).pagarRegistro();
}

describe('QuatriviumCredit - Morosity', function () {
  it('does not stack reputation penalties if marcarMorosoSiVencido is called twice', async () => {
    const { token, contract, owner, user, extra, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await drainToken(token, user, extra);

    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');

    await contract.marcarMorosoSiVencido(user.address);
    expect(await contract.prestamosMorosos(user.address)).to.equal(1n);
    expect(await contract.esMoroso(user.address)).to.equal(true);
    expect(await contract.reputacion(user.address)).to.equal(100n);

    await contract.marcarMorosoSiVencido(user.address);
    expect(await contract.prestamosMorosos(user.address)).to.equal(1n);
  });

  it('marks mora on due date without pulling allowance', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const before = await token.balanceOf(user.address);
    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');

    await contract.marcarMorosoSiVencido(user.address);
    expect(await contract.usuarios(user.address).then((u) => u.montoActivo)).to.equal(
      ethers.parseUnits('1', 18)
    );
    expect(await contract.esMoroso(user.address)).to.equal(true);
    expect(await token.balanceOf(user.address)).to.equal(before);
    const cash = await token.balanceOf(contractAddr);
    const outstanding = await contract.outstandingLoans(tokenAddr);
    const liquidity = await contract.totalLiquidity(tokenAddr);
    const fees = await contract.collectedFees(tokenAddr);
    expect(cash + outstanding).to.equal(liquidity + fees);
  });

  it('keeps earnings during the grace month then freezes them and burns 10 reputation per level per day', async () => {
    const { token, contract, owner, user, extra, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await drainToken(token, user, extra);

    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');
    await contract.marcarMorosoSiVencido(user.address);
    expect(await contract.dispersionCongelada(user.address)).to.equal(false);
    expect(await contract.reputacion(user.address)).to.equal(100n);

    await ethers.provider.send('evm_increaseTime', [30 * 24 * 3600 + 3 * 24 * 3600]);
    await ethers.provider.send('evm_mine');
    await contract.marcarMorosoSiVencido(user.address);
    expect(await contract.reputacion(user.address)).to.equal(70n);
    expect(await contract.esMoroso(user.address)).to.equal(true);
    expect(await contract.dispersionCongelada(user.address)).to.equal(true);
  });

  it('sends the delinquent referral cut to the pool after the grace month', async () => {
    const { token, contract, owner, user, extra: padre, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '2000');
    await registerAndFund(token, contract, padre);
    await registerAndFund(token, contract, user, '20', padre.address);
    await contract.connect(padre).solicitarPrestamo(tokenAddr, 0);
    await drainToken(token, padre, owner);

    const info = await contract.usuarios(padre.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');
    await contract.marcarMorosoSiVencido(padre.address);
    await ethers.provider.send('evm_increaseTime', [31 * 24 * 3600]);
    await ethers.provider.send('evm_mine');
    await contract.marcarMorosoSiVencido(padre.address);
    expect(await contract.dispersionCongelada(padre.address)).to.equal(true);

    const padreBefore = await token.balanceOf(padre.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);

    expectAmt((await token.balanceOf(padre.address)) - padreBefore, 0n);
    expect((await contract.totalLiquidity(tokenAddr)) - liqBefore).to.be.gt(0n);
  });

  it('records delinquency when a late repayment is made without a prior keeper call', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');

    const lateDebt = await contract.obtenerDeuda(user.address);
    await token.mint(user.address, lateDebt.total);
    await token.connect(user).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(user).pagarPrestamo(tokenAddr, lateDebt.total);

    expect(await contract.prestamosMorosos(user.address)).to.equal(1n);
    expect((await contract.obtenerProgresoUsuario(user.address)).solicitudesCompletadas).to.equal(
      0n
    );
  });

  it('marks the founder delinquent like any other unpaid loan', async () => {
    const { token, contract, owner, extra, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await enableFounderBorrow(token, contract, owner);
    await contract.connect(owner).solicitarPrestamo(tokenAddr, 0);
    await drainToken(token, owner, extra);

    const info = await contract.usuarios(owner.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');

    const liqBefore = await contract.totalLiquidity(tokenAddr);
    await contract.marcarMorosoSiVencido(owner.address);

    expect(await contract.esMoroso(owner.address)).to.equal(true);
    expect((await contract.usuarios(owner.address)).montoActivo).to.equal(
      ethers.parseUnits('1', 18)
    );
    expect(await contract.totalLiquidity(tokenAddr)).to.equal(liqBefore);
    await expect(contract.connect(owner).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
    const cash = await token.balanceOf(contractAddr);
    const outstanding = await contract.outstandingLoans(tokenAddr);
    const liquidity = await contract.totalLiquidity(tokenAddr);
    const fees = await contract.collectedFees(tokenAddr);
    expect(cash + outstanding).to.equal(liquidity + fees);
  });

  it('does not waive the founder 48h wait between loans', async () => {
    const { token, contract, owner, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await enableFounderBorrow(token, contract, owner);
    await contract.connect(owner).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(owner.address);
    await contract.connect(owner).pagarPrestamo(tokenAddr, debt.total);
    const progreso = await contract.obtenerProgresoUsuario(owner.address);
    expect(progreso[2]).to.be.gt(0n);
    await expect(contract.connect(owner).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
    await advanceCooldown();
    await expect(contract.connect(owner).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
    expect(await token.balanceOf(contractAddr)).to.be.gt(0n);
  });
});
