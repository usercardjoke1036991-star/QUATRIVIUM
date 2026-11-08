const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

async function warp(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine');
}

describe('Sequencer de Arbitrum y liquidaciones', function () {
  async function prestar() {
    const ctx = await deployProtocol();
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
      sequencer,
    } = ctx;
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const info = await contract.usuarios(user.address);
    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    return { ...ctx, liquidator, info };
  }

  it('no liquida si el sequencer está caído y suma ese tiempo a las 48 h', async () => {
    const { contract, user, liquidator, tokenAddr, sequencer, info } = await prestar();
    const caida = (await ethers.provider.getBlock('latest')).timestamp - 3 * 60 * 60;
    await sequencer.setRound(2, 1, caida, caida, 2);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(info.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await contract.anotarSequencer();
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.be.reverted;

    const vuelta = caida + 3 * 60 * 60;
    const ahora = (await ethers.provider.getBlock('latest')).timestamp;
    await sequencer.setRound(3, 0, vuelta, ahora, 3);
    await contract.anotarSequencer();
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.be.reverted;
    expect(await contract.graciaSequencer()).to.equal(3n * 60n * 60n);

    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(info.vencimiento) + 48 * 60 * 60 + 3 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;
  });

  it('no liquida durante la hora posterior al regreso y no frena préstamos ni pagos si el feed falla', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
      sequencer,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(info.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    const ahora = (await ethers.provider.getBlock('latest')).timestamp;
    await sequencer.setRound(4, 0, ahora - 20 * 60, ahora, 4);
    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.be.reverted;

    await sequencer.setRound(5, 0, 0, 0, 5);
    const debt = await contract.obtenerDeuda(user.address);
    await expect(contract.connect(user).pagarPrestamo(tokenAddr, debt.total)).to.not.be.reverted;
    await warp(48 * 60 * 60);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });
});
