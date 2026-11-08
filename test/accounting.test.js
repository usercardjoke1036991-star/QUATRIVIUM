const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, assertNavInvariant } = require('./helpers.cjs');

describe('QuatriviumCredit - Accounting', function () {
  let token, contract, owner, user, tokenAddr, contractAddr;

  beforeEach(async () => {
    ({ token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol());
    await seedPool(token, contract, owner, '500');
  });

  it('keeps cash + outstanding == liquidity + fees across deposit, borrow and repay', async () => {
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);

    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);

    const loan = await contract.usuarios(user.address);
    expect(loan.montoActivo).to.equal(ethers.parseUnits('1', 18));

    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);

    const after = await contract.usuarios(user.address);
    expect(after.montoActivo).to.equal(0n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('records LP shares but does not let anyone redeem the pool', async () => {
    const value = await contract.valorLp(owner.address, tokenAddr);
    expect(value).to.equal(ethers.parseUnits('500', 18));

    await expect(contract.connect(owner).retirarLiquidez(tokenAddr, value)).to.be.reverted;
    expect(await contract.valorLp(owner.address, tokenAddr)).to.equal(ethers.parseUnits('500', 18));
    expect(await contract.lpShares(owner.address, tokenAddr)).to.equal(
      ethers.parseUnits('500', 18)
    );
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('does not let a depositor pull cash while loans are outstanding', async () => {
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const lpValue = await contract.valorLp(owner.address, tokenAddr);
    await expect(contract.connect(owner).retirarLiquidez(tokenAddr, lpValue)).to.be.reverted;
  });
});
