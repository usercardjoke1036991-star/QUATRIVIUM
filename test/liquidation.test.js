const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('QuatriviumCredit - Liquidation', function () {
  async function advanceCooldown() {
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
  }

  it('allows a third-party write-off after default and keeps the debt', async () => {
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
    expect(postInfo.montoActivo).to.equal(ethers.parseUnits('1', 18));
    expect(await contract.esMoroso(user.address)).to.equal(true);
    expect(await contract.prestamosCerrados(user.address)).to.equal(0n);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.be.reverted;
  });

  it('writes off an L1 default without a prize and clears outstanding', async () => {
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
    const principal = debt.principal;
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const fondoBefore = await contract.fondoSeguro(tokenAddr);
    const outBefore = await contract.outstandingLoans(tokenAddr);
    const balBefore = await token.balanceOf(liquidator.address);
    await contract.connect(liquidator).liquidate(user.address, tokenAddr);

    expect(await contract.outstandingLoans(tokenAddr)).to.equal(outBefore - principal);
    const liqDelta = (await contract.totalLiquidity(tokenAddr)) - liqBefore;
    const fondoDelta = (await contract.fondoSeguro(tokenAddr)) - fondoBefore;
    expect(liqDelta + fondoDelta).to.equal(-principal);
    expect(await token.balanceOf(liquidator.address)).to.equal(balBefore);
    expect(await contract.castigado(user.address)).to.equal(principal);
  });

  it('keeps a written-off user blocked until he repays, then waits 48 h from the repayment', async () => {
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
    const poolBefore =
      (await contract.totalLiquidity(tokenAddr)) + (await contract.fondoSeguro(tokenAddr));
    await contract.connect(liquidator).liquidate(user.address, tokenAddr);

    await advanceCooldown();
    await token.mint(user.address, ethers.parseUnits('2', 18));
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;

    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    expect(await contract.castigado(user.address)).to.equal(0n);
    expect(await contract.esMoroso(user.address)).to.equal(false);
    const poolAfter =
      (await contract.totalLiquidity(tokenAddr)) + (await contract.fondoSeguro(tokenAddr));
    expect(poolAfter).to.be.gte(poolBefore);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
    await advanceCooldown();
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('rejects disabling a token while loans are outstanding', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
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
    await expect(
      contract.connect(user).liquidate(user.address, tokenAddr)
    ).to.be.revertedWithoutReason();
  });
});
