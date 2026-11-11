const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  deployProtocol,
  seedPool,
  registerAndFund,
  qualifyCollector,
  assertNavInvariant,
  drainToken,
  expectAmt,
} = require('./helpers.cjs');

const FUNDADOR_BP = 1500n;
const GEN_BP = [1500n, 800n, 600n, 400n, 200n];

async function advanceCooldown() {
  await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
  await ethers.provider.send('evm_mine');
}

async function borrowAndPay(contract, token, user, tokenAddr) {
  await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
  const debt = await contract.obtenerDeuda(user.address);
  await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
  return debt;
}

function corteFundador(interes) {
  return (interes * FUNDADOR_BP) / 10000n;
}

function parteSeguro(amount) {
  const seguro = (BigInt(amount) * 500n) / 10000n;
  return { pool: BigInt(amount) - seguro, seguro };
}

describe('QuatriviumCredit - Unilevel MLM', function () {
  it('hangs organic signups from the founder and rejects invalid parents', async () => {
    const { contract, owner, user, extra } = await deployProtocol();
    const raiz = await contract.fundador();
    expect(raiz).to.equal(owner.address);
    expect(await contract.humanosVerificados(owner.address)).to.equal(true);

    await expect(contract.connect(user).registrarHumanoConPadre(user.address)).to.be.reverted;
    await expect(contract.connect(user).registrarHumanoConPadre(extra.address)).to.be.reverted;

    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    expect((await contract.redGenealogica(user.address)).padre).to.equal(owner.address);
    expect(await contract.reputacion(user.address)).to.equal(100n);

    await contract.connect(extra).registrarHumanoConPadre(user.address);
    expect((await contract.redGenealogica(extra.address)).padre).to.equal(user.address);
  });

  it('keeps Level 1 at $1 with interest strictly above the referral bonus', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    const bono = await contract.BONO_ACTIVACION();

    expect(debt.principal).to.equal(ethers.parseUnits('1', 18));
    expect(debt.interes).to.equal(ethers.parseUnits('1', 18));
    expect(bono).to.equal(ethers.parseUnits('1', 18));
  });

  it('pays the one-time bonus only to the direct referrer on the first Level 1 repayment', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      user,
      extra: padre,
      tokenAddr,
      contractAddr,
      signers,
    } = await deployProtocol();
    const abuelo = signers[3];

    await seedPool(token, contract, owner, '500');
    await contract.connect(abuelo).registrarHumanoConPadre(ethers.ZeroAddress);
    await contract.connect(padre).registrarHumanoConPadre(abuelo.address);
    await registerAndFund(token, contract, user, '50', padre.address);
    await qualifyCollector(token, contract, abuelo);
    await qualifyCollector(token, contract, padre);
    await qualifyCollector(token, contract, owner);

    const padreBefore = await token.balanceOf(padre.address);
    const abueloBefore = await token.balanceOf(abuelo.address);
    const founderBefore = await token.balanceOf(owner.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const fondoBefore = await contract.fondoSeguro(tokenAddr);
    const founderFame0 = await fama.famaRed(owner.address);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);

    const bono = await contract.BONO_ACTIVACION();
    const founderCut = corteFundador(debt.interes);
    const gen2 = (debt.interes * GEN_BP[1]) / 10000n;
    const gen3 = (debt.interes * GEN_BP[2]) / 10000n;
    const poolInterest = debt.interes - founderCut - gen2 - gen3;
    const parte = parteSeguro(poolInterest);

    expectAmt((await token.balanceOf(padre.address)) - padreBefore, bono);
    expectAmt((await token.balanceOf(abuelo.address)) - abueloBefore, gen2);
    expectAmt((await token.balanceOf(owner.address)) - founderBefore, founderCut + gen3);
    expectAmt((await contract.totalLiquidity(tokenAddr)) - liqBefore, parte.pool);
    expectAmt((await contract.fondoSeguro(tokenAddr)) - fondoBefore, parte.seguro);
    expectAmt(founderCut + gen2 + gen3 + poolInterest, debt.interes);
    expect((await contract.redGenealogica(user.address)).bonoActivacionCobrado).to.equal(true);
    expect(await contract.reputacion(padre.address)).to.equal(300n);
    expect(await fama.famaCaja(padre.address)).to.equal(0n);
    expect(await fama.famaPorGeneracion(1)).to.equal(0n);
    expectAmt(await fama.famaPorGeneracion(2), 53n);
    expectAmt(await fama.famaRed(abuelo.address), 53n);
    expectAmt((await fama.famaRed(owner.address)) - founderFame0, 140n);
    expect((await contract.obtenerRedReputacion(padre.address)).puntos).to.equal(
      await fama.famaRed(padre.address)
    );
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('pays the founder on organic first loans and keeps the zero-sum split', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await qualifyCollector(token, contract, owner);

    const founderBefore = await token.balanceOf(owner.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const fondoBefore = await contract.fondoSeguro(tokenAddr);
    const debt = await borrowAndPay(contract, token, user, tokenAddr);
    const bono = await contract.BONO_ACTIVACION();
    const founderCut = corteFundador(debt.interes);

    const founderAfter = await token.balanceOf(owner.address);
    const liqAfter = await contract.totalLiquidity(tokenAddr);
    const fondoAfter = await contract.fondoSeguro(tokenAddr);
    const retenido = debt.interes - founderCut;
    const parte = parteSeguro(retenido);
    expect((BigInt(founderAfter) - BigInt(founderBefore)).toString()).to.equal(
      (BigInt(founderCut) + BigInt(bono)).toString()
    );
    expect((BigInt(liqAfter) - BigInt(liqBefore)).toString()).to.equal(parte.pool.toString());
    expect((BigInt(fondoAfter) - BigInt(fondoBefore)).toString()).to.equal(parte.seguro.toString());
    expectAmt(founderCut + (liqAfter - liqBefore) + (fondoAfter - fondoBefore), debt.interes);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('uses recurrent royalties plus the founder cut after the bonus is spent', async () => {
    const { token, contract, owner, tokenAddr, contractAddr, signers } = await deployProtocol();
    const [, child, g1, g2, g3, g4, g5] = signers;

    await seedPool(token, contract, owner, '500');
    await contract.connect(g5).registrarHumanoConPadre(ethers.ZeroAddress);
    await contract.connect(g4).registrarHumanoConPadre(g5.address);
    await contract.connect(g3).registrarHumanoConPadre(g4.address);
    await contract.connect(g2).registrarHumanoConPadre(g3.address);
    await contract.connect(g1).registrarHumanoConPadre(g2.address);
    await registerAndFund(token, contract, child, '50', g1.address);
    for (const g of [g5, g4, g3, g2, g1, owner]) {
      await qualifyCollector(token, contract, g);
    }

    await borrowAndPay(contract, token, child, tokenAddr);
    await advanceCooldown();

    const before = await Promise.all([
      token.balanceOf(g1.address),
      token.balanceOf(g2.address),
      token.balanceOf(g3.address),
      token.balanceOf(g4.address),
      token.balanceOf(g5.address),
      token.balanceOf(owner.address),
      contract.totalLiquidity(tokenAddr),
      contract.fondoSeguro(tokenAddr),
    ]);

    const debt = await borrowAndPay(contract, token, child, tokenAddr);
    const interes = debt.interes;
    const expected = GEN_BP.map((bp) => (interes * bp) / 10000n);
    const founderCut = corteFundador(interes);
    const gen6ToRoot = (interes * 80n) / 10000n;
    const poolShare = interes - founderCut - expected.reduce((a, b) => a + b, 0n) - gen6ToRoot;

    expect((BigInt(await token.balanceOf(g1.address)) - BigInt(before[0])).toString()).to.equal(
      BigInt(expected[0]).toString()
    );
    expectAmt((await token.balanceOf(g2.address)) - before[1], expected[1]);
    expectAmt((await token.balanceOf(g3.address)) - before[2], expected[2]);
    expectAmt((await token.balanceOf(g4.address)) - before[3], expected[3]);
    expectAmt((await token.balanceOf(g5.address)) - before[4], expected[4]);
    expectAmt((await token.balanceOf(owner.address)) - before[5], founderCut + gen6ToRoot);
    const partePool = parteSeguro(poolShare);
    expectAmt((await contract.totalLiquidity(tokenAddr)) - before[6], partePool.pool);
    expectAmt((await contract.fondoSeguro(tokenAddr)) - before[7], partePool.seguro);
    expectAmt(founderCut + expected.reduce((a, b) => a + b, 0n) + gen6ToRoot + poolShare, interes);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('keeps paying the upline after generation 5', async () => {
    const { token, contract, owner, tokenAddr, contractAddr, signers } = await deployProtocol();
    const [, child, g1, g2, g3, g4, g5, g6] = signers;

    await seedPool(token, contract, owner, '500');
    await contract.connect(g6).registrarHumanoConPadre(ethers.ZeroAddress);
    await contract.connect(g5).registrarHumanoConPadre(g6.address);
    await contract.connect(g4).registrarHumanoConPadre(g5.address);
    await contract.connect(g3).registrarHumanoConPadre(g4.address);
    await contract.connect(g2).registrarHumanoConPadre(g3.address);
    await contract.connect(g1).registrarHumanoConPadre(g2.address);
    await registerAndFund(token, contract, child, '50', g1.address);
    for (const g of [g6, g5, g4, g3, g2, g1, owner]) {
      await qualifyCollector(token, contract, g);
    }

    await borrowAndPay(contract, token, child, tokenAddr);
    await advanceCooldown();

    const g6Before = await token.balanceOf(g6.address);
    const ownerBefore = await token.balanceOf(owner.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const fondoBefore = await contract.fondoSeguro(tokenAddr);
    const debt = await borrowAndPay(contract, token, child, tokenAddr);
    const interes = debt.interes;
    const gen6Share = (interes * 80n) / 10000n;
    const gen7ToRoot = (interes * 80n) / 10000n;
    const poolShare = (await contract.totalLiquidity(tokenAddr)) - liqBefore;
    const fondoShare = (await contract.fondoSeguro(tokenAddr)) - fondoBefore;

    expectAmt((await token.balanceOf(g6.address)) - g6Before, gen6Share);
    expectAmt(
      (await token.balanceOf(owner.address)) - ownerBefore,
      corteFundador(interes) + gen7ToRoot
    );
    expect(poolShare + fondoShare).to.be.gte((interes * 4000n) / 10000n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('lets founders reassign who receives the 15% founder cut', async () => {
    const { token, contract, owner, user, extra, tokenAddr, contractAddr } = await deployProtocol();
    const extraAddr = extra.address;
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);

    expect(await contract.fundador()).to.equal(owner.address);
    await qualifyCollector(token, contract, owner);
    await contract.connect(owner).proponerFundador(extraAddr);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await contract.connect(owner).aplicarFundador();
    expect(await contract.fundador()).to.equal(extraAddr);

    const extraBefore = await token.balanceOf(extraAddr);
    const ownerBefore = await token.balanceOf(owner.address);
    const debt = await borrowAndPay(contract, token, user, tokenAddr);
    const founderCut = corteFundador(debt.interes);
    const bono = await contract.BONO_ACTIVACION();

    expectAmt((await token.balanceOf(extraAddr)) - extraBefore, founderCut);
    expectAmt((await token.balanceOf(owner.address)) - ownerBefore, bono);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('rejects setFundador for a wallet that is not an admin', async () => {
    const { contract, user } = await deployProtocol();
    await expect(contract.connect(user).proponerFundador(user.address)).to.be.reverted;
  });

  it('keeps paying the upline during the grace month and restores the debtor after pay', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: padre,
      tokenAddr,
      contractAddr,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '2000');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await qualifyCollector(token, contract, padre);
    await registerAndFund(token, contract, user, '20', padre.address);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await drainToken(token, user, owner);
    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');
    await contract.marcarMorosoSiVencido(user.address);

    expect(await contract.reputacion(user.address)).to.equal(100n);
    expect(await contract.dispersionCongelada(user.address)).to.equal(false);

    const padreBefore = await token.balanceOf(padre.address);
    const lateDebt = await contract.obtenerDeuda(user.address);
    await token.mint(user.address, lateDebt.total);
    await token.connect(user).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(user).pagarPrestamo(tokenAddr, lateDebt.total);

    const bono = await contract.BONO_ACTIVACION();
    expectAmt((await token.balanceOf(padre.address)) - padreBefore, bono);
    expect((await contract.redGenealogica(user.address)).bonoActivacionCobrado).to.equal(true);
    expect(await contract.dispersionCongelada(user.address)).to.equal(false);

    await advanceCooldown();
    await token.mint(user.address, ethers.parseUnits('2', 18));
    const padreMid = await token.balanceOf(padre.address);
    const next = await borrowAndPay(contract, token, user, tokenAddr);
    expectAmt(
      (await token.balanceOf(padre.address)) - padreMid,
      (next.interes * GEN_BP[0]) / 10000n
    );
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('does not pay network USDT or gen-1 caja fame on the first L1', async () => {
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
    await seedPool(token, contract, owner, '2000');
    await contract.connect(padre).registrarHumanoConPadre(ethers.ZeroAddress);
    await qualifyCollector(token, contract, padre);

    const kid = signers[3];
    const padreRep0 = await contract.reputacion(padre.address);
    await registerAndFund(token, contract, kid, '20', padre.address);
    expect(await contract.reputacion(padre.address)).to.equal(padreRep0);
    const founderFame0 = await fama.famaRed(owner.address);

    await borrowAndPay(contract, token, kid, tokenAddr);
    expect((await contract.obtenerRedReputacion(padre.address)).puntos).to.equal(
      await fama.famaRed(padre.address)
    );
    expect((await contract.obtenerRedReputacion(padre.address)).bonosCobrados).to.equal(
      await fama.famaRedCanjeada(padre.address)
    );
    expect(await contract.reputacion(padre.address)).to.equal(padreRep0 + 100n);
    expect(await fama.famaCaja(padre.address)).to.equal(0n);
    expectAmt((await fama.famaRed(owner.address)) - founderFame0, 153n);

    const padreBefore = await token.balanceOf(padre.address);
    const bonoActivacion = await contract.BONO_ACTIVACION();
    for (let i = 4; i <= 7; i += 1) {
      const next = signers[i];
      await registerAndFund(token, contract, next, '20', padre.address);
      await borrowAndPay(contract, token, next, tokenAddr);
    }

    expect((await contract.obtenerRedReputacion(padre.address)).puntos).to.equal(
      await fama.famaRed(padre.address)
    );
    expect((await contract.obtenerRedReputacion(padre.address)).bonosCobrados).to.equal(
      await fama.famaRedCanjeada(padre.address)
    );
    expectAmt((await token.balanceOf(padre.address)) - padreBefore, 4n * bonoActivacion);
    const red = await contract.obtenerRedReputacion(padre.address);
    expect(red.puntos).to.equal(await fama.famaRed(padre.address));
    expect(red.bonosCobrados).to.equal(await fama.famaRedCanjeada(padre.address));
    expect(await fama.famaCaja(padre.address)).to.equal(0n);
    expectAmt((await fama.famaRed(owner.address)) - founderFame0, 5n * 153n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('does not walk caja fame up the line on signup', async () => {
    const {
      token,
      contract,
      fama,
      owner,
      extra: a,
      tokenAddr,
      contractAddr,
      signers,
    } = await deployProtocol();
    const b = signers[3];
    const c = signers[4];

    await contract.connect(a).registrarHumanoConPadre(ethers.ZeroAddress);
    expect(await contract.reputacion(a.address)).to.equal(100n);
    expect(await contract.reputacion(owner.address)).to.equal(100n);
    expect(await fama.famaCaja(a.address)).to.equal(0n);

    await contract.connect(b).registrarHumanoConPadre(a.address);
    expect(await contract.reputacion(b.address)).to.equal(100n);
    expect(await contract.reputacion(a.address)).to.equal(100n);
    expect(await fama.famaCaja(a.address)).to.equal(0n);

    await contract.connect(c).registrarHumanoConPadre(b.address);
    expect(await contract.reputacion(c.address)).to.equal(100n);
    expect(await contract.reputacion(b.address)).to.equal(100n);

    await seedPool(token, contract, owner, '2000');
    await qualifyCollector(token, contract, b);
    const alta = await ethers.getContractAt('QuatriviumAlta', await fama.alta());
    await token.mint(c.address, ethers.parseUnits('20', 18));
    await token.connect(c).approve(await contract.getAddress(), ethers.MaxUint256);
    await token.connect(c).approve(await alta.getAddress(), ethers.MaxUint256);
    await alta.connect(c).pagarRegistro();
    await borrowAndPay(contract, token, c, tokenAddr);
    expect((await contract.obtenerRedReputacion(b.address)).puntos).to.equal(
      await fama.famaRed(b.address)
    );
    expect((await contract.obtenerRedReputacion(a.address)).puntos).to.equal(
      await fama.famaRed(a.address)
    );
    expect((await contract.obtenerRedReputacion(owner.address)).puntos).to.equal(
      await fama.famaRed(owner.address)
    );
    expect(await fama.famaCaja(b.address)).to.equal(0n);
    expect(await fama.famaRed(a.address)).to.equal(53n);
    expect(await contract.reputacion(b.address)).to.equal(300n);
    expect(await contract.reputacion(a.address)).to.equal(100n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });
});
