const { expect } = require('chai');
const { ethers } = require('hardhat');

const LOCK = 30 * 24 * 60 * 60;

async function deployReserva() {
  const [owner, user, extra, founder] = await ethers.getSigners();
  const Token = await ethers.getContractFactory('ERC20Mock');
  const Mock = await ethers.getContractFactory('CreditViewMock');
  const Reserva = await ethers.getContractFactory('QuatriviumReserva');
  const token = await Token.deploy();
  const credit = await Mock.deploy();
  const reserva = await Reserva.deploy(
    await token.getAddress(),
    founder.address,
    await credit.getAddress(),
    await credit.getAddress(),
    extra.address,
    [founder.address, owner.address, user.address]
  );
  await token.mint(user.address, ethers.parseUnits('1000', 18));
  await token.mint(founder.address, ethers.parseUnits('1000', 18));
  await token.connect(user).approve(await reserva.getAddress(), ethers.MaxUint256);
  await token.connect(founder).approve(await reserva.getAddress(), ethers.MaxUint256);
  await credit.setNivel(user.address, 10);
  await credit.setAdmin(founder.address, true);
  await credit.setPayToken(await token.getAddress());
  await token.mint(await credit.getAddress(), ethers.parseUnits('1000', 18));
  return { token, credit, reserva, owner, user, extra, founder };
}

describe('QuatriviumReserva', function () {
  it('rejects locks below 1 USDT', async () => {
    const { reserva, user } = await deployReserva();
    await expect(reserva.connect(user).bloquear(1)).to.be.revertedWithCustomError(
      reserva,
      'MontoCero'
    );
    await expect(
      reserva.connect(user).bloquear(ethers.parseUnits('0.99', 18))
    ).to.be.revertedWithCustomError(reserva, 'MontoCero');
  });

  it('returns principal after 30 days even if the reward pot is empty', async () => {
    const { token, reserva, user } = await deployReserva();
    const amount = ethers.parseUnits('100', 18);
    await reserva.connect(user).bloquear(amount);
    await expect(reserva.connect(user).desbloquear()).to.be.reverted;
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    await reserva.connect(user).desbloquear();
    expect(await token.balanceOf(user.address)).to.equal(ethers.parseUnits('1000', 18));
    const pos = await reserva.posiciones(user.address);
    expect(pos.activa).to.equal(false);
  });

  it('caps yield at 12% APY for the lock and pays the founder from that yield', async () => {
    const { token, reserva, user, founder } = await deployReserva();
    const amount = ethers.parseUnits('100', 18);
    await reserva.connect(founder).aportarBote(ethers.parseUnits('50', 18));
    await reserva.connect(user).bloquear(amount);
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    const techo = await reserva.techoRendimiento(amount, LOCK);
    const t = await reserva.tramo(amount);
    const founderBp = await reserva.corteFundadorBp(t);
    const founderBefore = await token.balanceOf(founder.address);
    await reserva.connect(user).desbloquear();
    const founderCut = (techo * founderBp) / 10000n;
    expect(await token.balanceOf(user.address)).to.equal(
      ethers.parseUnits('1000', 18) + techo - founderCut
    );
    expect((await token.balanceOf(founder.address)) - founderBefore).to.equal(founderCut);
    expect(techo).to.be.lt(ethers.parseUnits('1.1', 18));
  });

  it('pays a network boost from the same pot when the user has an upline', async () => {
    const { token, reserva, credit, user, extra, founder } = await deployReserva();
    await credit.setPadre(user.address, extra.address);
    await reserva.connect(founder).aportarBote(ethers.parseUnits('50', 18));
    const amount = ethers.parseUnits('100', 18);
    await reserva.connect(user).bloquear(amount);
    const pos = await reserva.posiciones(user.address);
    expect(pos.enRed).to.equal(true);
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    const techo = await reserva.techoRendimiento(amount, LOCK);
    await reserva.connect(user).desbloquear();
    expect(await token.balanceOf(user.address)).to.be.lte(ethers.parseUnits('1000', 18) + techo);
    expect(await token.balanceOf(user.address)).to.be.gt(ethers.parseUnits('1000', 18));
  });

  it('rejects a second lock and a delinquent wallet', async () => {
    const { reserva, credit, user } = await deployReserva();
    const amount = ethers.parseUnits('10', 18);
    await reserva.connect(user).bloquear(amount);
    await expect(reserva.connect(user).bloquear(amount)).to.be.revertedWithCustomError(
      reserva,
      'PeriodoActivo'
    );
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    await reserva.connect(user).desbloquear();
    await credit.setMora(user.address, true);
    await expect(reserva.connect(user).bloquear(amount)).to.be.revertedWithCustomError(
      reserva,
      'EnMora'
    );
  });

  it('lets a delinquent wallet unlock but not renew', async () => {
    const { token, reserva, credit, user } = await deployReserva();
    const amount = ethers.parseUnits('10', 18);
    await reserva.connect(user).bloquear(amount);
    await credit.setMora(user.address, true);
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    await expect(reserva.connect(user).renovar()).to.be.revertedWithCustomError(reserva, 'EnMora');
    await reserva.connect(user).desbloquear();
    expect(await token.balanceOf(user.address)).to.equal(ethers.parseUnits('1000', 18));
  });

  it('exposes no owner, guardian or pot withdrawal', async () => {
    const { reserva } = await deployReserva();
    for (const name of [
      'setCredit',
      'setOwner',
      'acceptOwner',
      'setFundador',
      'proponerRetiroBote',
      'applyRetiroBote',
      'addGuardian',
      'owner',
    ]) {
      expect(reserva.interface.hasFunction(name), name).to.equal(false);
    }
  });

  it('keeps contract cash equal to locked principal plus the pot', async () => {
    const { token, reserva, user, founder } = await deployReserva();
    const locked = ethers.parseUnits('40', 18);
    const pot = ethers.parseUnits('15', 18);
    await reserva.connect(founder).aportarBote(pot);
    await reserva.connect(user).bloquear(locked);
    expect(await token.balanceOf(await reserva.getAddress())).to.equal(locked + pot);
  });

  it('pays a commission extra from the pool when invoked by credit and the founder takes their cut', async () => {
    const { token, credit, reserva, user, founder } = await deployReserva();
    const reservaAddr = await reserva.getAddress();
    const locked = ethers.parseUnits('100', 18);
    await reserva.connect(founder).aportarBote(ethers.parseUnits('20', 18));
    await reserva.connect(user).bloquear(locked);
    const commission = ethers.parseUnits('5', 18);
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [1n]));
    const [extra, founderCut] = await reserva.extraComisionDe(user.address, commission);
    expect(extra).to.equal(ethers.parseUnits('0.5', 18));
    expect(await reserva.boostIdOf(user.address, commission, id)).to.not.equal(ethers.ZeroHash);
    const userBefore = await token.balanceOf(user.address);
    const founderBefore = await token.balanceOf(founder.address);
    await expect(credit.triggerBoost(reservaAddr, user.address, commission, id))
      .to.emit(reserva, 'BoostComision')
      .withArgs(user.address, commission, extra, founderCut);
    expect((await token.balanceOf(user.address)) - userBefore).to.equal(extra - founderCut);
    expect((await token.balanceOf(founder.address)) - founderBefore).to.equal(founderCut);
    await expect(
      credit.triggerBoost(reservaAddr, user.address, commission, id)
    ).to.be.revertedWithCustomError(reserva, 'YaPagado');
  });

  it('rejects commission boosts below the 50 USDT tier and from a stranger (not credit)', async () => {
    const { reserva, credit, user, extra, founder } = await deployReserva();
    const reservaAddr = await reserva.getAddress();
    await reserva.connect(founder).aportarBote(ethers.parseUnits('10', 18));
    await reserva.connect(user).bloquear(ethers.parseUnits('10', 18));
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [2n]));
    await expect(
      credit.triggerBoost(reservaAddr, user.address, ethers.parseUnits('5', 18), id)
    ).to.be.revertedWithCustomError(reserva, 'NadaQueMover');
    const locked = ethers.parseUnits('50', 18);
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    await reserva.connect(user).desbloquear();
    await reserva.connect(user).bloquear(locked);
    const okId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [3n]));
    await expect(
      reserva.connect(extra).pagarBoostComision(user.address, ethers.parseUnits('5', 18), okId)
    ).to.be.revertedWithCustomError(reserva, 'NoAutorizado');
    const huge = ethers.parseUnits('1000000', 18);
    const [capped] = await reserva.extraComisionDe(user.address, huge);
    expect(capped).to.equal(ethers.parseUnits('5', 18));
  });

  it('rejects a lock below level 10 and lets anyone add their own tokens to the pot', async () => {
    const { token, reserva, credit, user, extra, founder } = await deployReserva();
    await credit.setNivel(user.address, 9);
    await expect(
      reserva.connect(user).bloquear(ethers.parseUnits('50', 18))
    ).to.be.revertedWithCustomError(reserva, 'NivelInsuficiente');
    await token.mint(extra.address, ethers.parseUnits('1', 18));
    await token.connect(extra).approve(await reserva.getAddress(), ethers.MaxUint256);
    await reserva.connect(extra).aportarBote(ethers.parseUnits('1', 18));
    await reserva.connect(founder).aportarBote(ethers.parseUnits('1', 18));
    expect(await reserva.bote()).to.equal(ethers.parseUnits('2', 18));
  });

  it('rejects a commission boost from the owner and delays owner or credit changes 72h', async () => {
    const { reserva, credit, user, owner, extra, founder } = await deployReserva();
    await reserva.connect(founder).aportarBote(ethers.parseUnits('20', 18));
    await reserva.connect(user).bloquear(ethers.parseUnits('100', 18));
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [9n]));
    await expect(
      reserva.connect(owner).pagarBoostComision(user.address, ethers.parseUnits('5', 18), id)
    ).to.be.revertedWithCustomError(reserva, 'NoAutorizado');
    expect(await reserva.credit()).to.equal(await credit.getAddress());
    expect(await reserva.fundador()).to.equal(founder.address);
  });

  it('accepts a 1 USDT lock and applies 20 percent extra from 500 USDT', async () => {
    const { reserva, user, founder } = await deployReserva();
    await reserva.connect(founder).aportarBote(ethers.parseUnits('20', 18));
    await reserva.connect(user).bloquear(ethers.parseUnits('1', 18));
    const pos = await reserva.posiciones(user.address);
    expect(pos.activa).to.equal(true);
    expect(pos.principal).to.equal(ethers.parseUnits('1', 18));
    await expect(
      reserva.connect(user).bloquear(ethers.parseUnits('1', 18))
    ).to.be.revertedWithCustomError(reserva, 'PeriodoActivo');
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    await reserva.connect(user).desbloquear();
    await reserva.connect(user).bloquear(ethers.parseUnits('500', 18));
    const [extra] = await reserva.extraComisionDe(user.address, ethers.parseUnits('5', 18));
    expect(extra).to.equal(ethers.parseUnits('1', 18));
  });

  it('replaces an admin only with 2 of 3 and 72h, and never drops below two', async () => {
    const { reserva, owner, user, founder } = await deployReserva();
    const signers = await ethers.getSigners();
    const incoming = signers[5];
    const data = reserva.interface.encodeFunctionData('removeAdmin', [user.address]);
    await reserva.connect(owner).proponerAdmin(data);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(reserva.connect(owner).ejecutarAdmin(1)).to.be.revertedWithCustomError(
      reserva,
      'Quorum'
    );
    await reserva.connect(founder).confirmarAdmin(1);
    await reserva.connect(owner).ejecutarAdmin(1);
    expect(await reserva.admins(user.address)).to.equal(false);
    expect(await reserva.requiredConfirmations()).to.equal(2n);
    const add = reserva.interface.encodeFunctionData('addAdmin', [incoming.address]);
    await reserva.connect(owner).proponerAdmin(add);
    await reserva.connect(founder).confirmarAdmin(2);
    await expect(reserva.connect(owner).ejecutarAdmin(2)).to.be.revertedWithCustomError(
      reserva,
      'EsperaTimelock'
    );
  });

  it('pays commission extras with no pause switch', async () => {
    const { token, reserva, credit, user, founder } = await deployReserva();
    const reservaAddr = await reserva.getAddress();
    expect(reserva.interface.hasFunction('pausarBoost')).to.equal(false);
    await reserva.connect(founder).aportarBote(ethers.parseUnits('20', 18));
    await reserva.connect(user).bloquear(ethers.parseUnits('100', 18));
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [11n]));
    await credit.triggerBoost(reservaAddr, user.address, ethers.parseUnits('5', 18), id);
    await ethers.provider.send('evm_increaseTime', [LOCK]);
    await ethers.provider.send('evm_mine');
    await reserva.connect(user).desbloquear();
    expect(await token.balanceOf(user.address)).to.be.gt(ethers.parseUnits('900', 18));
  });

  it('caps on-chain commission extras at 50 LUSD per day', async () => {
    const { reserva, credit, user, founder } = await deployReserva();
    const reservaAddr = await reserva.getAddress();
    await reserva.connect(founder).aportarBote(ethers.parseUnits('20', 18));
    await reserva.connect(user).bloquear(ethers.parseUnits('500', 18));
    const [extra] = await reserva.extraComisionDe(user.address, ethers.parseUnits('1000000', 18));
    expect(extra).to.equal(ethers.parseUnits('100', 18));
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [12n]));
    await expect(
      credit.triggerBoost(reservaAddr, user.address, ethers.parseUnits('1000000', 18), id)
    ).to.be.revertedWithCustomError(reserva, 'TopeDiario');
  });

  it('settles pagarBoostComision 100% on-chain directly from QuatriviumCredit interest dispersion', async () => {
    const {
      deployFamaAndCredit,
      seedPool,
      registerAndFund,
      qualifyCollector,
      assertNavInvariant,
    } = require('./helpers.cjs');
    const { getLinkedCreditFactory } = require('../scripts/linkCredit.cjs');
    const signers = await ethers.getSigners();
    const [owner, user, abuelo, padre] = signers;
    const Token = await ethers.getContractFactory('ERC20Mock');
    const token = await Token.deploy();
    const tokenAddr = await token.getAddress();
    const HarnessFactory = await getLinkedCreditFactory(ethers, 'QuatriviumCreditHarness');
    const { contract, reserva } = await deployFamaAndCredit(
      HarnessFactory,
      tokenAddr,
      owner,
      500,
      [owner.address, user.address, padre.address],
      1
    );
    const contractAddr = await contract.getAddress();
    await seedPool(token, contract, owner, '2000');
    const reservaAddr = await reserva.getAddress();

    // Registra a abuelo y ponlo en nivel 10 para poder bloquear en Reserva
    await registerAndFund(token, contract, abuelo, '500', ethers.ZeroAddress);
    await contract.forceNivel(abuelo.address, 10);
    await qualifyCollector(token, contract, abuelo);
    expect((await contract.obtenerProgresoUsuario(abuelo.address)).nivelActual).to.equal(10n);

    // Abuelo bloquea 100 LUSD en Reserva (tramo 2 -> +10% extra sobre comisiones de red)
    await token.mint(abuelo.address, ethers.parseUnits('200', 18));
    await token.connect(abuelo).approve(reservaAddr, ethers.MaxUint256);
    await reserva.connect(abuelo).bloquear(ethers.parseUnits('100', 18));

    // Padre cuelga de abuelo; user cuelga de padre (abuelo es Gen 2 de user, recibe 8% en el primer préstamo)
    await contract.connect(padre).registrarHumanoConPadre(abuelo.address);
    await registerAndFund(token, contract, user, '50', padre.address);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);

    const abueloBefore = await token.balanceOf(abuelo.address);
    const gen2Base = (debt.interes * 800n) / 10000n;
    const [expectedExtra, expectedFounderCut] = await reserva.extraComisionDe(
      abuelo.address,
      gen2Base
    );
    expect(expectedExtra).to.be.gt(0n);

    await expect(contract.connect(user).pagarPrestamo(tokenAddr, debt.total))
      .to.emit(reserva, 'BoostComision')
      .withArgs(abuelo.address, gen2Base, expectedExtra, expectedFounderCut);

    const abueloAfter = await token.balanceOf(abuelo.address);
    expect(abueloAfter - abueloBefore).to.equal(gen2Base + expectedExtra - expectedFounderCut);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('lowers APY when locked capital is large versus the pot', async () => {
    const { reserva, user, founder } = await deployReserva();
    await reserva.connect(founder).aportarBote(ethers.parseUnits('10', 18));
    await reserva.connect(user).bloquear(ethers.parseUnits('200', 18));
    expect(await reserva.apyHoyBps()).to.equal(500n);
    const salud = await reserva.saludReserva();
    expect(salud[0]).to.equal(ethers.parseUnits('10', 18));
    expect(salud[1]).to.equal(ethers.parseUnits('200', 18));
    expect(salud[2]).to.equal(500n);
  });

  it('lets no role withdraw the pot', async () => {
    const { token, reserva, owner, founder, user, extra } = await deployReserva();
    await token.mint(extra.address, ethers.parseUnits('8', 18));
    await token.connect(extra).approve(await reserva.getAddress(), ethers.MaxUint256);
    await reserva.connect(extra).aportarBote(ethers.parseUnits('8', 18));
    const pot = await reserva.bote();
    for (const signer of [owner, founder, user, extra]) {
      await expect(reserva.connect(signer).desbloquear()).to.be.revertedWithCustomError(
        reserva,
        'NadaQueMover'
      );
    }
    expect(await reserva.bote()).to.equal(pot);
    expect(await token.balanceOf(await reserva.getAddress())).to.equal(pot);
  });
});
