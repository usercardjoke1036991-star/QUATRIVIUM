const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('QuatriviumCredit - Sovereign wallet-only onboarding (no attester / phone / device locks)', function () {
  it('lets a registered user borrow directly with their wallet without phone or device attestation', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    await token.mint(user.address, ethers.parseUnits('50', 18));
    await token.connect(user).approve(await contract.getAddress(), ethers.MaxUint256);

    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(
      ethers.parseUnits('1', 18)
    );
  });

  it('removes centralized identity functions and storage from QuatriviumCredit', async () => {
    const { contract } = await deployProtocol();
    for (const fn of [
      'vincularIdentidad',
      'phoneHashOf',
      'deviceHashOf',
      'walletOfPhone',
      'walletOfDevice',
      'attestNonce',
      'attester',
      'setAttester',
      'identidadExigida',
      'setIdentidadExigida',
    ]) {
      expect(contract.interface.hasFunction(fn), fn).to.equal(false);
    }
  });

  it('requires Alta (4 LUSD) when QuatriviumAlta is linked before borrowing', async () => {
    const { token, contract, fama, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');

    const Reserva = await ethers.getContractFactory('QuatriviumReserva');
    const reserva = await Reserva.deploy(
      tokenAddr,
      owner.address,
      contractAddr,
      await fama.getAddress()
    );
    const Alta = await ethers.getContractFactory('QuatriviumAlta');
    const alta = await Alta.deploy(tokenAddr, contractAddr, await reserva.getAddress());
    await fama.connect(owner).setAlta(await alta.getAddress());
    await fama.connect(owner).setReserva(await reserva.getAddress());
    await reserva.connect(owner).setAltaFuente(await alta.getAddress());

    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;

    await token.mint(user.address, ethers.parseUnits('10', 18));
    await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
    await alta.connect(user).pagarRegistro();

    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('lets the founder borrow directly without phone or device attestation', async () => {
    const { token, contract, owner, extra, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await expect(contract.connect(owner).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;

    await registerAndFund(token, contract, extra);
    await expect(contract.connect(extra).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });
});
