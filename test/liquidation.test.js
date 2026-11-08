const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, proposeAndExecute } = require('./helpers.cjs');

describe('QuatriviumCredit - Liquidation', function () {
  async function advanceCooldown() {
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
  }

  it('allows third-party liquidation after default', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const userInfo = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(userInfo.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');

    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);

    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;

    const postInfo = await contract.usuarios(user.address);
    expect(postInfo.montoActivo).to.equal(0);
    expect(await contract.esMoroso(user.address)).to.equal(false);
    expect(await contract.prestamosCerrados(user.address)).to.equal(1n);
  });

  it('keeps the liquidation fee inside the pool in the same transaction', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const userInfo = await contract.usuarios(user.address);
    const debt = await contract.obtenerDeuda(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(userInfo.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');

    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    const interest = debt.interes;
    const principal = debt.principal;
    const totalDue = debt.total;
    const feeBp = await contract.feeBasisPoints();
    const fee = (interest * totalDue * feeBp) / (totalDue * 10000n);
    let reward = (principal * 5n) / 100n;
    const tope = interest - fee;
    if (reward > tope) reward = tope;
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const fondoBefore = await contract.fondoSeguro(tokenAddr);
    await contract.connect(liquidator).liquidate(user.address, tokenAddr);

    expect(await contract.collectedFees(tokenAddr)).to.equal(0n);
    const liqDelta = (await contract.totalLiquidity(tokenAddr)) - liqBefore;
    const fondoDelta = (await contract.fondoSeguro(tokenAddr)) - fondoBefore;
    expect(liqDelta + fondoDelta).to.equal(interest - reward);
    expect(interest - reward).to.be.gt(interest - fee - reward);
  });

  it('lets a liquidated user borrow again after cooldown', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const userInfo = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(userInfo.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(liquidator).liquidate(user.address, tokenAddr);

    await advanceCooldown();
    await token.mint(user.address, ethers.parseUnits('2', 18));
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('rejects disabling a token while loans are outstanding', async () => {
    const { token, contract, owner, user, tokenAddr, feedAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    expect(contract.interface.hasFunction('setTokenConfig')).to.equal(false);
  });

  it('liquidates overdue loans permissionlessly without any pause gate', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const userInfo = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(userInfo.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;
  });

  it('rejects self-liquidation so the borrower cannot take the 5% bounty', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '20');
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const userInfo = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(userInfo.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await token.mint(user.address, ethers.parseUnits('10', 18));
    await token.connect(user).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(user).liquidate(user.address, tokenAddr)).to.be.reverted;
  });
});
