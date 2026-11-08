const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  deployProtocol,
  seedPool,
  registerAndFund,
  attestIdentity,
  proposeAndExecute,
} = require('./helpers.cjs');

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

  it('blocks direct admin changes; they must pass timelock', async () => {
    const { contract, owner } = await deployProtocol();
    await expect(contract.connect(owner).setFeeBP(100)).to.be.reverted;
  });

  it('executes admin actions only after 72h timelock', async () => {
    const { contract, owner } = await deployProtocol();
    const data = contract.interface.encodeFunctionData('setFeeBP', [100]);
    await contract.connect(owner).proposeAdminAction(data);
    await expect(contract.connect(owner).executeAdminAction(1)).to.be.reverted;

    await proposeAndExecute(contract, owner, 'setFeeBP', [100]);
    expect(await contract.feeBasisPoints()).to.equal(100n);
  });

  it('requires two confirmations when configured as 2-of-2', async () => {
    const signers = await ethers.getSigners();
    const owner = signers[0];
    const admin2 = signers[1];
    const { contract } = await deployProtocol({
      admins: [owner.address, admin2.address],
      confirms: 2,
    });

    const data = contract.interface.encodeFunctionData('setFeeBP', [200]);
    await contract.connect(owner).proposeAdminAction(data);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(owner).executeAdminAction(1)).to.be.reverted;

    await contract.connect(admin2).confirmAdminAction(1);
    await contract.connect(owner).executeAdminAction(1);
    expect(await contract.feeBasisPoints()).to.equal(200n);
  });

  it('locks 2-of-3 as soon as the third founder is added', async () => {
    const signers = await ethers.getSigners();
    const owner = signers[0];
    const admin2 = signers[2];
    const admin3 = signers[3];
    const { contract } = await deployProtocol();

    await proposeAndExecute(contract, owner, 'addAdmin', [admin2.address]);
    await proposeAndExecute(contract, owner, 'addAdmin', [admin3.address]);
    expect(await contract.requiredConfirmations()).to.equal(2n);

    const data = contract.interface.encodeFunctionData('setFeeBP', [250]);
    await contract.connect(owner).proposeAdminAction(data);
    const id = await contract.proposalCount();
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(owner).executeAdminAction(id)).to.be.reverted;

    await contract.connect(admin2).confirmAdminAction(id);
    await contract.connect(owner).executeAdminAction(id);
    expect(await contract.feeBasisPoints()).to.equal(250n);
  });

  it('forces 2-of-3 even if deploy asked for 1 signature with three admins', async () => {
    const signers = await ethers.getSigners();
    const [owner, , admin2, admin3] = signers;
    const { contract } = await deployProtocol({
      admins: [owner.address, admin2.address, admin3.address],
      confirms: 1,
    });
    expect(await contract.requiredConfirmations()).to.equal(2n);

    const data = contract.interface.encodeFunctionData('setFeeBP', [300]);
    await contract.connect(owner).proposeAdminAction(data);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(owner).executeAdminAction(1)).to.be.reverted;

    await contract.connect(admin2).confirmAdminAction(1);
    await contract.connect(owner).executeAdminAction(1);
    expect(await contract.feeBasisPoints()).to.equal(300n);
  });

  it('lets two founders remove a third without that third signature', async () => {
    const signers = await ethers.getSigners();
    const [owner, , admin2, hacked] = signers;
    const { contract } = await deployProtocol({
      admins: [owner.address, admin2.address, hacked.address],
      confirms: 2,
    });

    const data = contract.interface.encodeFunctionData('removeAdmin', [hacked.address]);
    await contract.connect(owner).proposeAdminAction(data);
    await contract.connect(admin2).confirmAdminAction(1);
    await ethers.provider.send('evm_increaseTime', [72 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await contract.connect(owner).executeAdminAction(1);

    expect(await contract.admins(hacked.address)).to.equal(false);
    expect(await contract.requiredConfirmations()).to.equal(2n);
  });

  it('exposes no pause or banWallet kill switches while keeping founder rotation under timelock', async () => {
    const { contract, owner, extra } = await deployProtocol();
    expect(contract.interface.hasFunction('pausarContrato')).to.equal(false);
    expect(contract.interface.hasFunction('despausarContrato')).to.equal(false);
    expect(contract.interface.hasFunction('banWallet')).to.equal(false);
    await proposeAndExecute(contract, owner, 'addAdmin', [extra.address]);
    await proposeAndExecute(contract, owner, 'setFundador', [extra.address]);
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
