const { expect } = require('chai');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('Tope de tasa al pedir un préstamo', function () {
  it('revierte TasaSubio si la tasa del momento supera la aceptada y presta si cabe', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    const tasa = await contract.obtenerTasaInteresActual(tokenAddr);
    const piso = (await contract.niveles(1))[2];
    const aplicada = tasa > piso ? tasa : piso;
    await expect(
      contract.connect(user).solicitarPrestamoConTope(tokenAddr, 0, aplicada - 1n)
    ).to.be.revertedWithCustomError(contract, 'TasaSubio');
    expect((await contract.usuarios(user.address)).montoActivo).to.equal(0n);
    await contract.connect(user).solicitarPrestamoConTope(tokenAddr, 0, aplicada);
    expect((await contract.usuarios(user.address)).tasaAplicadaBP).to.equal(aplicada);
  });
});
