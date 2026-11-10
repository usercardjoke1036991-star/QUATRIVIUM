const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

async function warp(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine');
}

async function proponerPausa(contract, proposer, confirmer, { wait = true, confirm = true } = {}) {
  const data = contract.interface.encodeFunctionData('pausarPrestamosNuevos', []);
  const tx = await contract.connect(proposer).proposeAdminAction(data);
  await tx.wait();
  const id = await contract.proposalCount();
  if (confirm) await contract.connect(confirmer).confirmAdminAction(id);
  if (wait) await warp(72 * 60 * 60);
  return id;
}

describe('Pausa de préstamos con quórum', function () {
  it('un admin solo no puede pausar ni saltarse las 72 h', async () => {
    const { contract, owner, user } = await deployProtocol();
    await expect(contract.connect(owner).pausarPrestamosNuevos()).to.be.reverted;
    const id = await proponerPausa(contract, owner, user, { wait: false });
    await expect(contract.connect(owner).executeAdminAction(id)).to.be.reverted;
    await expect(contract.connect(owner).confirmAdminAction(id)).to.be.reverted;
  });

  it('dos admins pausan tras 72 h, la pausa se levanta sola y el descanso bloquea otra', async () => {
    const { token, contract, owner, user, extra, tokenAddr, reserva } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);

    const id = await proponerPausa(contract, owner, extra);
    await contract.connect(owner).executeAdminAction(id);
    const hasta = await contract.pausaPrestamosHasta();
    const reposo = await contract.pausaReposoHasta();
    expect(reposo - hasta).to.equal(7n * 24n * 60n * 60n);

    const debt = await contract.obtenerDeuda(user.address);
    await expect(contract.connect(user).pagarPrestamo(tokenAddr, debt.total)).to.not.be.reverted;
    await token.mint(owner.address, ethers.parseUnits('2', 18));
    await token.connect(owner).approve(await reserva.getAddress(), ethers.MaxUint256);
    await expect(reserva.connect(owner).aportarBote(ethers.parseUnits('1', 18))).to.not.be.reverted;

    await warp(48 * 60 * 60);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;

    await warp(7 * 24 * 60 * 60);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
    await expect(
      proponerPausa(contract, owner, extra, { wait: false })
    ).to.be.revertedWithCustomError(contract, 'PausaEnReposo');

    await warp(7 * 24 * 60 * 60);
    const otra = await proponerPausa(contract, owner, extra);
    await contract.connect(owner).executeAdminAction(otra);
    expect(await contract.pausaPrestamosHasta()).to.be.greaterThan(hasta);
  });

  it('la pausa no impide liquidar', async () => {
    const { token, contract, owner, user, extra, tokenAddr, contractAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 1);
    const info = await contract.usuarios(user.address);
    const id = await proponerPausa(contract, owner, extra);
    await contract.connect(owner).executeAdminAction(id);
    await ethers.provider.send('evm_setNextBlockTimestamp', [
      Number(info.vencimiento) + 48 * 60 * 60 + 10,
    ]);
    await ethers.provider.send('evm_mine');
    await token.mint(extra.address, ethers.parseUnits('10', 18));
    await token.connect(extra).approve(contractAddr, ethers.MaxUint256);
    await expect(contract.connect(extra).liquidate(user.address, tokenAddr)).to.not.be.reverted;
  });
});
