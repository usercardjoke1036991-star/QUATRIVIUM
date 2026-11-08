const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool } = require('./helpers.cjs');

describe('QuatriviumCredit - Sovereign KYC-free borrowing', function () {
  it('lets a registered user borrow directly without KYC declaration', async () => {
    const { token, contract, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, (await ethers.getSigners())[0], '500');
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    await token.mint(user.address, ethers.parseUnits('50', 18));
    await token.connect(user).approve(await contract.getAddress(), ethers.MaxUint256);

    expect(contract.interface.hasFunction('declararKyc')).to.equal(false);
    expect(contract.interface.hasFunction('kycDeclarado')).to.equal(false);
    expect(contract.interface.hasFunction('kycExigido')).to.equal(false);
    expect(contract.interface.hasFunction('setKycExigido')).to.equal(false);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('requires registration before borrowing', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
  });
});
