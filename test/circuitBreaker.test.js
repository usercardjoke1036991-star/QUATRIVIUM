const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool } = require('./helpers.cjs');

describe('QuatriviumCredit - Sovereign Pool & Zero Kill Switches', function () {
  it('rejects user pool withdrawals ("pool locked") and exposes no pause or banWallet kill switches', async () => {
    const { token, contract, owner, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '1000');

    await expect(contract.connect(owner).retirarLiquidez(tokenAddr, ethers.parseUnits('600', 18)))
      .to.be.reverted;

    expect(contract.interface.hasFunction('pausarContrato')).to.equal(false);
    expect(contract.interface.hasFunction('despausarContrato')).to.equal(false);
    expect(contract.interface.hasFunction('banWallet')).to.equal(false);
  });
});
