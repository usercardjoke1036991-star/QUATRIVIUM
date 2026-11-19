const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol } = require('./helpers.cjs');

async function warp(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine');
}

describe('Fundador nuevo y votos de admins removidos', function () {
  it('tras el relevo, el alta sin invitación cuelga del fundador nuevo', async () => {
    const { contract, owner, signers } = await deployProtocol();
    const next = signers[3];
    const entrante = signers[4];
    await contract.connect(owner).proponerFundador(next.address);
    await warp(72 * 60 * 60 + 1);
    await contract.connect(owner).aplicarFundador();
    expect(await contract.fundador()).to.equal(next.address);
    expect(await contract.humanosVerificados(next.address)).to.equal(true);
    await contract.connect(entrante).registrarHumanoConPadre(ethers.ZeroAddress);
    const nodo = await contract.redGenealogica(entrante.address);
    expect(nodo.padre).to.equal(next.address);
  });

  it('el voto de un admin removido deja de contar en Credit', async () => {
    const { contract, owner, user, extra } = await deployProtocol();
    const pausa = contract.interface.encodeFunctionData('pausarPrestamosNuevos', []);
    const quitar = contract.interface.encodeFunctionData('removeAdmin', [user.address]);
    await contract.connect(owner).proposeAdminAction(pausa);
    await contract.connect(user).confirmAdminAction(1);
    await contract.connect(owner).proposeAdminAction(quitar);
    await contract.connect(extra).confirmAdminAction(2);
    await warp(72 * 60 * 60 + 1);
    await contract.connect(owner).executeAdminAction(2);
    expect(await contract.admins(user.address)).to.equal(false);
    await expect(contract.connect(owner).executeAdminAction(1)).to.be.revertedWithCustomError(
      contract,
      'VotosInsuficientes'
    );
  });

  it('el voto de un admin removido deja de contar en Reserva', async () => {
    const { reserva, owner, user, extra } = await deployProtocol();
    const quitarUser = reserva.interface.encodeFunctionData('removeAdmin', [user.address]);
    const quitarExtra = reserva.interface.encodeFunctionData('removeAdmin', [extra.address]);
    await reserva.connect(owner).proponerAdmin(quitarUser);
    await reserva.connect(extra).confirmarAdmin(1);
    await reserva.connect(owner).proponerAdmin(quitarExtra);
    await reserva.connect(user).confirmarAdmin(2);
    await warp(72 * 60 * 60 + 1);
    await reserva.connect(owner).ejecutarAdmin(2);
    expect(await reserva.admins(extra.address)).to.equal(false);
    await expect(reserva.connect(owner).ejecutarAdmin(1)).to.be.revertedWithCustomError(
      reserva,
      'Quorum'
    );
  });
});
