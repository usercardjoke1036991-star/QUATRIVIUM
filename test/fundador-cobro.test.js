const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, qualifyCollector } = require('./helpers.cjs');

describe('Fundador cobra en automático', function () {
  it('recibe 1 LUSD del alta y el 15% del interés en la misma transacción de pago', async () => {
    const { token, contract, alta, owner, user, extra: padre, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '100');
    await qualifyCollector(token, contract, padre);

    const antesAlta = await token.balanceOf(owner.address);
    await registerAndFund(token, contract, user, '20', padre.address);
    const trasAlta = await token.balanceOf(owner.address);
    expect(trasAlta - antesAlta).to.equal(ethers.parseUnits('1', 18));
    expect(await alta.registroHecho(user.address)).to.equal(true);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    const corte = (debt.interes * 1500n) / 10000n;
    expect(debt.interes).to.equal(ethers.parseUnits('1', 18));
    expect(corte).to.equal(ethers.parseUnits('0.15', 18));

    const antesPago = await token.balanceOf(owner.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    expect((await token.balanceOf(owner.address)) - antesPago).to.equal(corte);
    expect(contract.interface.hasFunction('retirarComisiones')).to.equal(false);
    expect(contract.interface.hasFunction('retirarComisionesToken')).to.equal(false);
  });
});
