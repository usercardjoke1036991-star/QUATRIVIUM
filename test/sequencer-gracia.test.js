const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

const HORA = 60 * 60;
const DIA = 24 * HORA;

describe('Sequencer de Arbitrum y liquidaciones', function () {
  async function prestar() {
    const ctx = await deployProtocol();
    const { token, contract, owner, user, extra: liquidator, tokenAddr, contractAddr } = ctx;
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const info = await contract.usuarios(user.address);
    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    return { ...ctx, liquidator, info };
  }

  async function en(timestamp) {
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);
    await ethers.provider.send('evm_mine');
  }

  function marca(timestamp) {
    return ethers.provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);
  }

  it('liquida con una ronda de hace 174 días y answer 0, sin que nadie anote la caída', async () => {
    const { contract, user, liquidator, tokenAddr, sequencer, info } = await prestar();
    const ahora = (await ethers.provider.getBlock('latest')).timestamp;
    const viejo = ahora - 174 * DIA;
    await sequencer.setRound(2, 0, viejo, viejo, 2);
    await en(info.vencimiento + 48n * BigInt(HORA) + 10n);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
  });

  it('no liquida si answer es 1, y tras volver espera más de una hora', async () => {
    const { contract, user, liquidator, tokenAddr, sequencer, info } = await prestar();
    const listo = info.vencimiento + 48n * BigInt(HORA) + 10n;
    await en(listo);
    const ahora = (await ethers.provider.getBlock('latest')).timestamp;
    await sequencer.setRound(2, 1, ahora - 60, ahora - 60, 2);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr))
      .to.be.revertedWithCustomError(contract, 'SequencerNoListo');

    await sequencer.setRound(3, 0, ahora, ahora, 3);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr))
      .to.be.revertedWithCustomError(contract, 'SequencerNoListo');

    await marca(BigInt(ahora) + BigInt(HORA));
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr))
      .to.be.revertedWithCustomError(contract, 'SequencerNoListo');

    await marca(BigInt(ahora) + BigInt(HORA) + 2n);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
  });

  it('una caída de 20 h leída de la ronda anterior suma 48 h + 20 h + 1 h', async () => {
    const { contract, user, liquidator, tokenAddr, sequencer, info } = await prestar();
    const vuelta = info.vencimiento + 48n * BigInt(HORA) + 20n * BigInt(HORA);
    const caida = vuelta - 20n * BigInt(HORA);
    await sequencer.setRound(2, 1, caida, caida, 2);
    await sequencer.setRound(3, 0, vuelta, vuelta, 3);

    await marca(vuelta + BigInt(HORA));
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr))
      .to.be.revertedWithCustomError(contract, 'SequencerNoListo');

    await marca(vuelta + BigInt(HORA) + 2n);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
  });

  it('si la hora de margen ya pasó, la caída de 20 h sigue frenando con GraciaLiquidacion', async () => {
    const { contract, user, liquidator, tokenAddr, sequencer, info } = await prestar();
    const vuelta = info.vencimiento + 2n * BigInt(HORA);
    const caida = vuelta - 20n * BigInt(HORA);
    await sequencer.setRound(2, 1, caida, caida, 2);
    await sequencer.setRound(3, 0, vuelta, vuelta, 3);

    const pronto = info.vencimiento + 48n * BigInt(HORA) + 10n;
    await en(pronto);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr))
      .to.be.revertedWithCustomError(contract, 'GraciaLiquidacion');

    await en(info.vencimiento + 48n * BigInt(HORA) + 20n * BigInt(HORA) + 2n);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;
  });

  it('si el feed falla o la ronda viene vacía, se pospone la liquidación y el pago sigue', async () => {
    const { contract, user, liquidator, tokenAddr, sequencer, info } = await prestar();
    await en(info.vencimiento + 48n * BigInt(HORA) + 10n);
    await sequencer.setRound(4, 0, 0, 0, 4);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr))
      .to.be.revertedWithCustomError(contract, 'SequencerNoListo');
    const debt = await contract.obtenerDeuda(user.address);
    await expect(contract.connect(user).pagarPrestamo(tokenAddr, debt.total)).to.not.be.reverted;
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
  });
});
