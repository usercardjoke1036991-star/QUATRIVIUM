const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('QuatriviumCredit - no destroy account and sovereign wallet access', function () {
  it('does not expose destruirCuenta, vincularIdentidad, declararKyc, pausarContrato or banWallet', async () => {
    const { token, contract, owner, user, extra, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    expect(contract.interface.hasFunction('destruirCuenta')).to.equal(false);
    expect(contract.interface.hasFunction('cuentaDestruida')).to.equal(false);
    expect(contract.interface.hasFunction('vincularIdentidad')).to.equal(false);
    expect(contract.interface.hasFunction('declararKyc')).to.equal(false);
    expect(contract.interface.hasFunction('pausarContrato')).to.equal(false);
    expect(contract.interface.hasFunction('banWallet')).to.equal(false);

    await registerAndFund(token, contract, extra);
    await expect(contract.connect(extra).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
    expect(await token.balanceOf(user.address)).to.be.gt(0n);
    expect(tokenAddr).to.be.a('string');
  });
});
