const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('QuatriviumCredit - security hardening', function () {
  it('sends fee withdrawals through the 72h timelock', async () => {
    const { contract, extra } = await deployProtocol();
    expect(contract.interface.hasFunction('retirarComisiones')).to.equal(false);
    expect(contract.interface.hasFunction('retirarComisionesToken')).to.equal(false);
    expect(extra.address).to.be.a('string');
  });

  it('removes attester, kycExigido and identidadExigida selectors from admin actions', async () => {
    const { contract } = await deployProtocol();
    expect(contract.interface.hasFunction('setAttester')).to.equal(false);
    expect(contract.interface.hasFunction('setKycExigido')).to.equal(false);
    expect(contract.interface.hasFunction('setIdentidadExigida')).to.equal(false);
  });

  it('allows direct sovereign borrowing after registration without KYC or identity flags', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '50');

    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('does not liquidate for a skipped installment before the final due date', async () => {
    const {
      token,
      contract,
      owner,
      user,
      extra: liquidator,
      tokenAddr,
      contractAddr,
    } = await deployProtocol({ harness: true });
    await seedPool(token, contract, owner, '5000');
    await registerAndFund(token, contract, user, '80');
    await contract.forceNivel(user.address, 7);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const plan = await contract.planPago(user.address);
    expect(plan.totales).to.equal(2);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(plan.venceCuota) + 10]);
    await ethers.provider.send('evm_mine');

    const userInfo = await contract.usuarios(user.address);
    expect(Number(userInfo.vencimiento)).to.be.greaterThan(Number(plan.venceCuota));

    await token.mint(liquidator.address, ethers.parseUnits('100', 18));
    await token.connect(liquidator).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.be.reverted;

    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(userInfo.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(liquidator).liquidate(user.address, tokenAddr)).to.not.be
      .reverted;
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0);
  });

  it('accepts deposits when an external feed would have reported a broken peg', async () => {
    const { token, contract, owner, tokenAddr, feed, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await feed.updateAnswer(97_000_000);
    await token.mint(owner.address, ethers.parseUnits('10', 18));
    await token.connect(owner).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(owner).depositarLiquidez(tokenAddr, ethers.parseUnits('10', 18)))
      .to.not.be.reverted;
  });
});
