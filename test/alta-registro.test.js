const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, expectAmt } = require('./helpers.cjs');

async function deployAltaStack() {
  const ctx = await deployProtocol();
  const { token, user, contractAddr, alta } = ctx;
  await token.mint(user.address, ethers.parseUnits('20', 18));
  await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
  await token.connect(user).approve(contractAddr, ethers.MaxUint256);
  return ctx;
}

describe('Alta 4 USDT', function () {
  it('parte 1 fundador, 1 Reserva, 1 sello y aparta 1 al padrino', async () => {
    const { token, contract, reserva, alta, owner, user } = await deployAltaStack();
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    const founderBefore = await token.balanceOf(owner.address);
    const boteBefore = await reserva.bote();
    await alta.connect(user).pagarRegistro();
    expect(await alta.registroHecho(user.address)).to.equal(true);
    expectAmt((await token.balanceOf(owner.address)) - founderBefore, ethers.parseUnits('1', 18));
    expectAmt((await reserva.bote()) - boteBefore, ethers.parseUnits('1', 18));
    expectAmt(await alta.padrinoApartado(user.address), ethers.parseUnits('1', 18));
    expectAmt(await contract.reservaPrimera(user.address), ethers.parseUnits('1', 18));
  });

  it('al pagar el primer L1 suelta el 1 del padrino y no saca otro de la caja', async () => {
    const { token, contract, alta, owner, user, extra, tokenAddr } = await deployAltaStack();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, extra, '20');
    await contract.connect(extra).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(extra)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(extra.address)).total);
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await registerAndFund(token, contract, user, '20', extra.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const padreBefore = await token.balanceOf(extra.address);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const deuda = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, deuda[2]);
    expectAmt(await alta.padrinoApartado(user.address), 0n);
    expectAmt((await token.balanceOf(extra.address)) - padreBefore, ethers.parseUnits('1', 18));
    expect(
      BigInt(await contract.totalLiquidity(tokenAddr)) >=
        BigInt(liqBefore) - ethers.parseUnits('1', 18)
    ).to.equal(true);
  });

  it('con Alta el sello no entra por pagarVerificacion directo', async () => {
    const { contract, user, tokenAddr } = await deployAltaStack();
    await expect(contract.connect(user).pagarVerificacion(tokenAddr, ethers.parseUnits('1', 18))).to
      .be.reverted;
  });

  it('onAlta solo lo llama el contrato Alta y exige tokens en caja', async () => {
    const { reserva, owner } = await deployAltaStack();
    await expect(reserva.connect(owner).onAlta(ethers.parseUnits('1', 18))).to.be.reverted;
  });

  it('con Alta, sin pagarRegistro el préstamo revierte', async () => {
    const { token, contract, owner, user, extra, tokenAddr } = await deployAltaStack();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, extra, '20');
    await contract.connect(user).registrarHumanoConPadre(extra.address);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
  });

  it('al vencer, el USDT del padrino se anota al deudor', async () => {
    const { token, contract, alta, owner, user, extra } = await deployAltaStack();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, extra, '20');
    await registerAndFund(token, contract, user, '20', extra.address);
    const extraAntes = await contract.verificadoAlPool(extra.address);
    const userAntes = await contract.verificadoAlPool(user.address);
    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine', []);
    await alta.connect(extra).vencerPadrinoAlPool(user.address);
    expect(await alta.cargoDe()).to.equal(0n);
    expectAmt(await contract.verificadoAlPool(extra.address), extraAntes);
    expectAmt(
      await contract.verificadoAlPool(user.address),
      userAntes + ethers.parseUnits('1', 18)
    );
  });

  it('si no paga el L1 en 7 días el 1 del padrino va al pool', async () => {
    const { token, contract, alta, owner, user, extra, tokenAddr } = await deployAltaStack();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, extra, '20');
    await registerAndFund(token, contract, user, '20', extra.address);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const fondoBefore = await contract.fondoSeguro(tokenAddr);
    const padreBefore = await token.balanceOf(extra.address);
    await expect(alta.connect(user).vencerPadrinoAlPool(user.address)).to.be.reverted;
    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine', []);
    await alta.connect(user).vencerPadrinoAlPool(user.address);
    expectAmt(await alta.padrinoApartado(user.address), 0n);
    expectAmt((await token.balanceOf(extra.address)) - padreBefore, 0n);
    const uno = ethers.parseUnits('1', 18);
    const seguro = uno / 20n;
    expectAmt(await contract.totalLiquidity(tokenAddr), liqBefore + uno - seguro);
    expectAmt(await contract.fondoSeguro(tokenAddr), fondoBefore + seguro);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const deuda = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, deuda[2]);
    const padreTrasPago = (await token.balanceOf(extra.address)) - padreBefore;
    expect(BigInt(padreTrasPago) < ethers.parseUnits('1', 18)).to.equal(true);
  });

  it('tras el primer L1 no se puede pagar el alta otra vez', async () => {
    const { token, contract, alta, owner, user, extra, tokenAddr } = await deployAltaStack();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, extra, '20');
    await registerAndFund(token, contract, user, '20', extra.address);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const deuda = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, deuda[2]);
    expectAmt(await alta.padrinoApartado(user.address), 0n);
    expect(await alta.registroHecho(user.address)).to.equal(true);
    await expect(alta.connect(user).pagarRegistro()).to.be.reverted;
  });
});
