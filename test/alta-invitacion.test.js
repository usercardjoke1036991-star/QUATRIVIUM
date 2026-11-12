const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  deployProtocol,
  seedPool,
  registerAndFund,
  qualifyCollector,
  expectAmt,
} = require('./helpers.cjs');

const UNO = () => ethers.parseUnits('1', 18);

async function caja(token, addrs) {
  let total = 0n;
  for (const addr of addrs) total += await token.balanceOf(addr);
  return total;
}

async function titulares(token, contract, alta, reserva, personas) {
  return [
    ...personas,
    await alta.getAddress(),
    await reserva.getAddress(),
    await contract.getAddress(),
  ];
}

describe('Alta: invitación, sin invitación y conservación', function () {
  it('con invitación válida el padrino listo cobra el 1 al pagar el L1 y no se crea LUSD', async () => {
    const {
      token,
      contract,
      alta,
      reserva,
      owner,
      user,
      extra: padre,
      tokenAddr,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '100');
    await qualifyCollector(token, contract, padre);
    await contract.connect(user).registrarHumanoConPadre(padre.address);
    expect((await contract.redGenealogica(user.address)).padre).to.equal(padre.address);

    await token.mint(user.address, UNO() * 8n);
    await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
    await token.connect(user).approve(await contract.getAddress(), ethers.MaxUint256);
    const quienes = await titulares(token, contract, alta, reserva, [
      owner.address,
      user.address,
      padre.address,
    ]);
    const antes = await caja(token, quienes);
    const padreAntes = await token.balanceOf(padre.address);
    await alta.connect(user).pagarRegistro();
    expect(await caja(token, quienes)).to.equal(antes);
    expectAmt(await alta.padrinoApartado(user.address), UNO());
    expect(await token.balanceOf(padre.address)).to.equal(padreAntes);

    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const deuda = await contract.obtenerDeuda(user.address);
    const emision = await caja(token, quienes);
    await contract.connect(user).pagarPrestamo(tokenAddr, deuda.total);
    expect(await caja(token, quienes)).to.equal(emision);
    expectAmt(await alta.padrinoApartado(user.address), 0n);
    expectAmt((await token.balanceOf(padre.address)) - padreAntes, UNO());
  });

  it('sin invitación el 1 apartado entra al pool al pagar el L1 y no se queda en Alta', async () => {
    const { token, contract, alta, reserva, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '100');
    await contract.connect(user).registrarHumanoConPadre(ethers.ZeroAddress);
    expect((await contract.redGenealogica(user.address)).padre).to.equal(owner.address);
    expect(await contract.cobradorListo(owner.address)).to.equal(false);

    await token.mint(user.address, UNO() * 8n);
    await token.connect(user).approve(await alta.getAddress(), ethers.MaxUint256);
    await token.connect(user).approve(await contract.getAddress(), ethers.MaxUint256);
    const quienes = await titulares(token, contract, alta, reserva, [owner.address, user.address]);
    const antes = await caja(token, quienes);
    const fundadorAntes = await token.balanceOf(owner.address);
    await alta.connect(user).pagarRegistro();
    expect(await caja(token, quienes)).to.equal(antes);
    expectAmt((await token.balanceOf(owner.address)) - fundadorAntes, UNO());
    expectAmt(await alta.padrinoApartado(user.address), UNO());

    const fondo = await contract.fondoSeguro(tokenAddr);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const deuda = await contract.obtenerDeuda(user.address);
    const emision = await caja(token, quienes);
    const fundadorTrasAlta = await token.balanceOf(owner.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, deuda.total);
    expect(await caja(token, quienes)).to.equal(emision);
    expectAmt(await alta.padrinoApartado(user.address), 0n);
    expectAmt(await token.balanceOf(await alta.getAddress()), 0n);
    expectAmt(
      (await token.balanceOf(owner.address)) - fundadorTrasAlta,
      (deuda.interes * 1500n) / 10000n
    );
    expect((await contract.fondoSeguro(tokenAddr)) > fondo).to.equal(true);
  });

  it('un invitador no registrado revierte y no mueve LUSD', async () => {
    const { token, contract, owner, user, extra } = await deployProtocol();
    await token.mint(user.address, UNO() * 4n);
    const quienes = [user.address, extra.address, owner.address];
    const antesUser = await token.balanceOf(user.address);
    const antes = await caja(token, quienes);
    await expect(
      contract.connect(user).registrarHumanoConPadre(extra.address)
    ).to.be.revertedWithoutReason();
    expect(await contract.humanosVerificados(user.address)).to.equal(false);
    expect(await token.balanceOf(user.address)).to.equal(antesUser);
    expect(await caja(token, quienes)).to.equal(antes);
  });

  it('no deja invitarse a sí mismo', async () => {
    const { contract, user } = await deployProtocol();
    await expect(
      contract.connect(user).registrarHumanoConPadre(user.address)
    ).to.be.revertedWithoutReason();
    expect(await contract.humanosVerificados(user.address)).to.equal(false);
  });

  it('una segunda cuenta puede nombrar a la primera y esa cobra 1, pagando los otros 3', async () => {
    const {
      token,
      contract,
      alta,
      reserva,
      owner,
      user,
      extra: primero,
      tokenAddr,
    } = await deployProtocol();
    await seedPool(token, contract, owner, '200');
    await qualifyCollector(token, contract, primero);
    await registerAndFund(token, contract, user, '20', primero.address);
    const primeroAntes = await token.balanceOf(primero.address);
    const quienes = await titulares(token, contract, alta, reserva, [
      owner.address,
      user.address,
      primero.address,
    ]);
    const emision = await caja(token, quienes);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    const deuda = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, deuda.total);
    expect(await caja(token, quienes)).to.equal(emision);
    expectAmt((await token.balanceOf(primero.address)) - primeroAntes, UNO());
    expectAmt(await alta.padrinoApartado(user.address), 0n);
  });
});
