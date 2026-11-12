const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('Quatrivium Finance - uncollateralized credit and admin locks', function () {
  it('lets a user register and borrow without locking collateral', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');

    await registerAndFund(token, contract, user);
    const walletBefore = await token.balanceOf(user.address);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const walletAfter = await token.balanceOf(user.address);

    expect(walletAfter - walletBefore).to.equal(ethers.parseUnits('1', 18));
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(
      ethers.parseUnits('1', 18)
    );
  });

  it('levels up only when the loan is paid on time', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);

    let progress = await contract.obtenerProgresoUsuario(user.address);
    expect(progress.solicitudesCompletadas).to.equal(1n);
    expect(progress.nivelActual).to.equal(1n);

    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const info = await contract.usuarios(user.address);
    await ethers.provider.send('evm_setNextBlockTimestamp', [Number(info.vencimiento) + 10]);
    await ethers.provider.send('evm_mine');

    await token.mint(user.address, debt.total);
    await token.connect(user).approve(contractAddr, ethers.MaxUint256);
    const lateDebt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, lateDebt.total);

    progress = await contract.obtenerProgresoUsuario(user.address);
    expect(progress.solicitudesCompletadas).to.equal(1n);
    expect(progress.nivelActual).to.equal(1n);
  });

  it('blocks direct fee changes because admins cannot move rates', async () => {
    const { contract } = await deployProtocol();
    expect(contract.interface.hasFunction('setFeeBP')).to.equal(false);
    expect(contract.interface.hasFunction('setOwner')).to.equal(false);
    expect(contract.interface.hasFunction('retirarComisiones')).to.equal(false);
  });

  it('removes an admin only with 2 of 3 and a 72h timelock, and keeps quorum at 2', async () => {
    const { contract, owner, user, extra } = await deployProtocol();
    expect(await contract.requiredConfirmations()).to.equal(2n);
    const data = contract.interface.encodeFunctionData('removeAdmin', [extra.address]);
    await contract.connect(owner).proposeAdminAction(data);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(owner).executeAdminAction(1)).to.be.revertedWithCustomError(
      contract,
      'VotosInsuficientes'
    );
    await contract.connect(user).confirmAdminAction(1);
    await contract.connect(owner).executeAdminAction(1);
    expect(await contract.admins(extra.address)).to.equal(false);
    expect(await contract.requiredConfirmations()).to.equal(2n);
  });

  it('pauses only new loans for 7 days and still accepts repayment', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const data = contract.interface.encodeFunctionData('pausarPrestamosNuevos', []);
    const proposed = await contract.connect(owner).proposeAdminAction(data);
    await proposed.wait();
    const id = await contract.proposalCount();
    await contract.connect(user).confirmAdminAction(id);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await contract.connect(owner).executeAdminAction(id);
    const debt = await contract.obtenerDeuda(user.address);
    await expect(contract.connect(user).pagarPrestamo(tokenAddr, debt.total)).to.not.be.reverted;
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(
      contract.connect(user).solicitarPrestamo(tokenAddr, 0)
    ).to.be.revertedWithoutReason();
    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('lets only the current founder rotate the founder wallet after 72h', async () => {
    const { contract, owner, user, extra } = await deployProtocol();
    await expect(
      contract.connect(user).proponerFundador(extra.address)
    ).to.be.revertedWithoutReason();
    await contract.connect(owner).proponerFundador(extra.address);
    await contract.connect(owner).cancelarFundador();
    await expect(contract.connect(owner).aplicarFundador()).to.be.revertedWithoutReason();
    await contract.connect(owner).proponerFundador(extra.address);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await contract.connect(owner).aplicarFundador();
    expect(await contract.fundador()).to.equal(extra.address);
  });

  it('keeps registration, borrowing and repayment unstoppable at all times', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    await expect(contract.connect(user).pagarPrestamo(tokenAddr, debt.total)).to.not.be.reverted;
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
  });

  it('fits under the EIP-170 runtime size limit', async () => {
    const { artifacts } = require('hardhat');
    const art = await artifacts.readArtifact('QuatriviumCredit');
    const size = (art.deployedBytecode.length - 2) / 2;
    expect(size).to.be.at.most(24576);
  });
});
