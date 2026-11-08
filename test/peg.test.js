const { expect } = require('chai');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('QuatriviumCredit - LUSD fijo sin oráculo', function () {
  it('lets a loan through when a feed would be under 0.98 or older than 25h', async () => {
    const { token, contract, owner, user, tokenAddr, feed } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await feed.updateAnswer(97_000_000);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    expect(contract.interface.hasFunction('assertPeg')).to.equal(false);
  });
});
