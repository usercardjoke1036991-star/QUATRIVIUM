const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  deployProtocol,
  seedPool,
  registerAndFund,
  proposeAndExecute,
  assertNavInvariant,
  expectAmt,
} = require('./helpers.cjs');

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

async function borrowAndPay(contract, user, tokenAddr) {
  await advanceCooldown();
  await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
  const debt = await contract.obtenerDeuda(user.address);
  await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
}

describe('QuatriviumCredit - cuotas desde $50', function () {
  it('keeps Level 1 as a single payment and splits $50 into two installments', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '200');

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const l1Plan = await contract.planPago(user.address);
    const debt = await contract.obtenerDeuda(user.address);
    expect(l1Plan.totales).to.equal(1);
    expect(montoCuota(debt.total, l1Plan.pagado, l1Plan.totales, l1Plan.pagadas)).to.equal(
      debt.total
    );
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);

    await borrowAndPay(contract, user, tokenAddr);
    await borrowAndPay(contract, user, tokenAddr);

    await proposeAndExecute(contract, owner, 'setNivel', [
      2,
      ethers.parseUnits('50', 18),
      35 * 24 * 60 * 60,
      1400,
    ]);

    await advanceCooldown();
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const full = await contract.obtenerDeuda(user.address);
    const plan = await contract.planPago(user.address);
    expect(plan.totales).to.equal(2);
    expect(plan.pagadas).to.equal(0);
    const cuota = montoCuota(full.total, plan.pagado, plan.totales, plan.pagadas);
    expect(cuota).to.equal(full.total / 2n);

    await expect(contract.connect(user).pagarPrestamo(tokenAddr, cuota - 1n)).to.be.reverted;

    await contract.connect(user).pagarPrestamo(tokenAddr, cuota);
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(
      ethers.parseUnits('50', 18)
    );

    const midDebt = await contract.obtenerDeuda(user.address);
    const mid = await contract.planPago(user.address);
    expect(mid.pagadas).to.equal(1);
    const segunda = montoCuota(midDebt.total, mid.pagado, mid.totales, mid.pagadas);
    expect(segunda).to.equal(full.total - cuota);

    await contract.connect(user).pagarPrestamo(tokenAddr, segunda);
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
    const done = await contract.planPago(user.address);
    expect(done.pagado).to.equal(0n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('pays referral commissions on each installment, adding up to the full share', async () => {
    const { token, contract, owner, user, extra: padre, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await registerAndFund(token, contract, user, '200', padre.address);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const first = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, first.total);
    await borrowAndPay(contract, user, tokenAddr);
    await borrowAndPay(contract, user, tokenAddr);

    await proposeAndExecute(contract, owner, 'setNivel', [
      2,
      ethers.parseUnits('50', 18),
      35 * 24 * 60 * 60,
      1400,
    ]);

    await advanceCooldown();
    const padreBefore = await token.balanceOf(padre.address);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    const plan = await contract.planPago(user.address);
    const fullShare = (debt.interes * 1500n) / 10000n;
    const cuota = montoCuota(debt.total, plan.pagado, plan.totales, plan.pagadas);

    await contract.connect(user).pagarPrestamo(tokenAddr, cuota);
    const afterFirst = await token.balanceOf(padre.address);
    const firstSlice = afterFirst - padreBefore;
    expect(firstSlice).to.be.gt(0n);
    expect(firstSlice).to.be.lt(fullShare);

    const mid = await contract.planPago(user.address);
    const midDebt = await contract.obtenerDeuda(user.address);
    await contract
      .connect(user)
      .pagarPrestamo(tokenAddr, montoCuota(midDebt.total, mid.pagado, mid.totales, mid.pagadas));
    const afterAll = await token.balanceOf(padre.address);
    expectAmt(afterAll - padreBefore, fullShare);
  });

  it('lets an unlocked user keep requesting any lower level and rejects locked levels', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '200');

    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 2)).to.be.reverted;

    await contract.connect(user).solicitarPrestamo(tokenAddr, 1);
    let debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    await borrowAndPay(contract, user, tokenAddr);
    await borrowAndPay(contract, user, tokenAddr);

    await advanceCooldown();
    await contract.connect(user).solicitarPrestamo(tokenAddr, 1);
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(
      ethers.parseUnits('1', 18)
    );
    debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
  });

  it('keeps on-time ranking if installments are skipped and the loan is paid before the final due date', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '200');

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    let debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    await borrowAndPay(contract, user, tokenAddr);
    await borrowAndPay(contract, user, tokenAddr);

    await proposeAndExecute(contract, owner, 'setNivel', [
      2,
      ethers.parseUnits('50', 18),
      35 * 24 * 60 * 60,
      1400,
    ]);

    await advanceCooldown();
    const before = await contract.obtenerProgresoUsuario(user.address);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const plan = await contract.planPago(user.address);
    const info = await contract.usuarios(user.address);
    expect(plan.totales).to.equal(2);
    expect(plan.venceCuota).to.be.lt(info.vencimiento);

    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(plan.venceCuota) + 10]);
    await ethers.provider.send('evm_mine');
    await expect(contract.marcarMorosoSiVencido(user.address)).to.be.reverted;

    debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
    const after = await contract.obtenerProgresoUsuario(user.address);
    expect(after[1]).to.equal(before[1] + 1n);
  });
});
