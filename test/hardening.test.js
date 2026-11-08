const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, assertNavInvariant } = require('./helpers.cjs');

function montoCuota(total, pagado, totales, pagadas) {
  const restante = total - pagado;
  const left = totales > pagadas ? totales - pagadas : 1n;
  if (left <= 1n) return restante;
  return restante / left;
}

async function advanceCooldown() {
  await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
  await ethers.provider.send('evm_mine');
}

describe('QuatriviumCredit - hardening', function () {
  it('locks LP withdrawals so the pool matches the public deposit policy', async () => {
    const { token, contract, owner, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    const value = await contract.valorLp(owner.address, tokenAddr);
    await expect(contract.connect(owner).retirarLiquidez(tokenAddr, value)).to.be.reverted;
    expect(await contract.valorLp(owner.address, tokenAddr)).to.equal(ethers.parseUnits('475', 18));
  });

  it('always allows deposits and repayments without any pause gate', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    await token.mint(owner.address, ethers.parseUnits('10', 18));
    await token.connect(owner).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(owner).depositarLiquidez(tokenAddr, ethers.parseUnits('10', 18)))
      .to.not.be.reverted;

    const debt = await contract.obtenerDeuda(user.address);
    await expect(contract.connect(user).pagarPrestamo(tokenAddr, debt.total)).to.not.be.reverted;
  });

  it('lets only the proposer cancel an admin action', async () => {
    const signers = await ethers.getSigners();
    const owner = signers[0];
    const admin2 = signers[1];
    const admin3 = signers[2];
    const { contract } = await deployProtocol({
      admins: [owner.address, admin2.address, admin3.address],
    });
    const data = contract.interface.encodeFunctionData('removeAdmin', [admin3.address]);
    await contract.connect(owner).proposeAdminAction(data);
    await expect(contract.connect(admin2).cancelAdminAction(1)).to.be.reverted;
    await contract.connect(owner).cancelAdminAction(1);
    await expect(contract.connect(owner).executeAdminAction(1)).to.be.reverted;
  });

  it('does not count a lower-tier loan toward the next level', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '20');

    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await advanceCooldown();
      await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
      const debt = await contract.obtenerDeuda(user.address);
      await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    }
    expect((await contract.obtenerProgresoUsuario(user.address)).nivelActual).to.equal(2n);

    await advanceCooldown();
    await contract.connect(user).solicitarPrestamo(tokenAddr, 1);
    const lowerPos = await contract.usuarios(user.address);
    expect(lowerPos.nivelActual).to.equal(1n);
    const lower = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, lower.total);
    const progress = await contract.obtenerProgresoUsuario(user.address);
    expect(progress.nivelActual).to.equal(2n);
    expect(progress.solicitudesCompletadas).to.equal(0n);
  });

  it('splits $60 into three installments and keeps NAV', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol({
      harness: true,
    });
    await seedPool(token, contract, owner, '1000');
    await registerAndFund(token, contract, user, '200');

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(user)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(user.address)).total);
    await advanceCooldown();
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(user)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(user.address)).total);
    await advanceCooldown();
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(user)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(user.address)).total);

    await contract.forceNivel(user.address, 8);

    await advanceCooldown();
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const full = await contract.obtenerDeuda(user.address);
    const plan0 = await contract.planPago(user.address);
    expect(plan0.totales).to.equal(3);
    const c1 = montoCuota(full.total, plan0.pagado, plan0.totales, plan0.pagadas);
    await contract.connect(user).pagarPrestamo(tokenAddr, c1);

    const mid = await contract.planPago(user.address);
    const midDebt = await contract.obtenerDeuda(user.address);
    const c2 = montoCuota(midDebt.total, mid.pagado, mid.totales, mid.pagadas);
    await contract.connect(user).pagarPrestamo(tokenAddr, c2);

    const last = await contract.planPago(user.address);
    const lastDebt = await contract.obtenerDeuda(user.address);
    const c3 = montoCuota(lastDebt.total, last.pagado, last.totales, last.pagadas);
    expect(c1 + c2 + c3).to.equal(full.total);
    await contract.connect(user).pagarPrestamo(tokenAddr, c3);
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('does not pay network commissions on liquidation', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: padre,
      tokenAddr,
      contractAddr,
      signers,
    } = await deployProtocol();
    const liquidator = signers[3];
    await seedPool(token, contract, owner, '500');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, user, '20', padre.address);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(info.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');

    const padreBefore = await token.balanceOf(padre.address);
    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(liquidator).liquidate(user.address, tokenAddr);
    expect(await token.balanceOf(padre.address)).to.equal(padreBefore);
  });

  it('does not block a loan when an external price feed is stale or missing', async () => {
    const { token, contract, owner, user, tokenAddr, feed } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);

    await feed.setRound(2, 100000000, 1, 1, 2);
    await ethers.provider.send('evm_increaseTime', [26 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    expect(contract.interface.hasFunction('assertPeg')).to.equal(false);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('credits two liquidity providers proportionally', async () => {
    const { token, contract, owner, extra, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await token.mint(extra.address, ethers.parseUnits('500', 18));
    await token.connect(extra).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(extra).depositarLiquidez(tokenAddr, ethers.parseUnits('500', 18));
    expect(await contract.valorLp(owner.address, tokenAddr)).to.equal(ethers.parseUnits('475', 18));
    expect(await contract.valorLp(extra.address, tokenAddr)).to.equal(ethers.parseUnits('475', 18));
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('raises the utilization curve above the base rate', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '100');
    await registerAndFund(token, contract, user);
    const before = await contract.obtenerTasaInteresActual(tokenAddr);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const after = await contract.obtenerTasaInteresActual(tokenAddr);
    expect(after).to.be.gt(before);
  });
});
