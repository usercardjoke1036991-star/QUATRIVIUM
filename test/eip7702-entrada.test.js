const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

async function delegate(address) {
  const code = `0xef0100${ethers.ZeroAddress.slice(2)}`;
  await ethers.provider.send('hardhat_setCode', [address, code]);
}

describe('EIP-7702 entrada y salida', function () {
  let delegated = '';

  afterEach(async function () {
    if (!delegated) return;
    await ethers.provider.send('hardhat_setCode', [delegated, '0x']);
    delegated = '';
  });

  it('una cuenta delegada no entra al alta y si paga su propio prestamo', async () => {
    const { token, contract, alta, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user, '54');
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(user.address);
    delegated = user.address;
    await delegate(user.address);
    await expect(alta.connect(user).pagarRegistro()).to.be.revertedWithCustomError(alta, 'SoloEOA');
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);
    const despues = await contract.usuarios(user.address);
    expect(despues.montoActivo).to.equal(0n);
  });
});
