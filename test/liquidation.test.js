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
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(userInfo.vencimiento) + 10]);
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

  it('takes the liquidation fee from interest without dividing first', async () => {
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
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(userInfo.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');

    await token.mint(liquidator.address, ethers.parseUnits('10', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(liquidator).liquidate(user.address, tokenAddr);

    const interest = debt.interes;
    const totalDue = debt.total;
    const feeBp = await contract.feeBasisPoints();
    const expectedFee = (interest * totalDue * feeBp) / (totalDue * 10000n);
    expect(await contract.collectedFees(tokenAddr)).to.equal(expectedFee);
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
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(userInfo.vencimiento) + 10]);
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

    await expect(proposeAndExecute(contract, owner, 'setTokenConfig', [tokenAddr, feedAddr, false]))
      .to.be.reverted;
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
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(userInfo.vencimiento) + 10]);
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
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(userInfo.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');
    await token.mint(user.address, ethers.parseUnits('10', 18));
    await token.connect(user).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(user).liquidate(user.address, tokenAddr)).to.be.reverted;
  });
});
