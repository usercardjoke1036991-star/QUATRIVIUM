const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund, qualifyCollector } = require('./helpers.cjs');

describe('Fama de donación y de depósito no sale del pool', function () {
  it('donar, canjear y devolver no saca LUSD del pool', async () => {
    const { token, contract, fama, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '5000');
    await registerAndFund(token, contract, user, '20');
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(user)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(user.address)).total);

    const gift = ethers.parseUnits('1000', 18);
    await token.mint(user.address, gift);
    await token.connect(user).approve(await contract.getAddress(), gift);
    const poolBefore = await contract.totalLiquidity(tokenAddr);
    const cajaBefore = await token.balanceOf(await contract.getAddress());
    await contract.connect(user).donar(tokenAddr, gift);
    expect(await fama.famaVisible(user.address)).to.equal(100000n);
    expect(await fama.famaDisponible(user.address)).to.equal(0n);
    expect(await token.balanceOf(owner.address)).to.be.gte(gift);

    await expect(fama.connect(user).canjearFama(250n)).to.be.revertedWithCustomError(fama, 'SinFama');
    await token.connect(owner).transfer(user.address, gift);
    expect(await contract.totalLiquidity(tokenAddr)).to.equal(poolBefore);
    expect(await token.balanceOf(await contract.getAddress())).to.equal(cajaBefore);
  });

  it('depositar da fama visible y no derecho a canje', async () => {
    const { token, contract, fama, owner, user, tokenAddr } = await deployProtocol();
    await seedPool(token, contract, owner, '50');
    await registerAndFund(token, contract, user, '20');
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(user)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(user.address)).total);
    const amount = ethers.parseUnits('10', 18);
    await token.mint(user.address, amount);
    await token.connect(user).approve(await contract.getAddress(), amount);
    const poolBefore = await contract.totalLiquidity(tokenAddr);
    await contract.connect(user).depositarLiquidez(tokenAddr, amount);
    expect(await fama.famaVisible(user.address)).to.equal(1000n);
    expect(await fama.famaDisponible(user.address)).to.equal(0n);
    await expect(fama.connect(user).canjearFama(250n)).to.be.revertedWithCustomError(fama, 'SinFama');
    expect(await contract.totalLiquidity(tokenAddr)).to.be.gt(poolBefore);
  });

  it('el canje de fama de intereses pagados sigue sacando 1 LUSD', async () => {
    const { token, contract, fama, owner, extra: padre, tokenAddr, signers } = await deployProtocol();
    const abuelo = signers[3];
    await seedPool(token, contract, owner, '500');
    await contract.connect(abuelo).registrarHumanoConPadre(ethers.ZeroAddress);
    await contract.connect(padre).registrarHumanoConPadre(abuelo.address);
    await qualifyCollector(token, contract, abuelo);
    await qualifyCollector(token, contract, padre);
    for (let i = 0; i < 5; i++) {
      const hijo = signers[4 + i];
      await registerAndFund(token, contract, hijo, '20', padre.address);
      await contract.connect(hijo).solicitarPrestamo(tokenAddr, 0);
      const debt = await contract.obtenerDeuda(hijo.address);
      await contract.connect(hijo).pagarPrestamo(tokenAddr, debt.total);
    }
    expect(await fama.famaRed(abuelo.address)).to.be.gte(250n);
    const liqBefore = await contract.totalLiquidity(tokenAddr);
    const balBefore = await token.balanceOf(abuelo.address);
    await fama.connect(abuelo).canjearFamaRed(250n);
    expect(await token.balanceOf(abuelo.address)).to.equal(balBefore + ethers.parseUnits('1', 18));
    expect(await contract.totalLiquidity(tokenAddr)).to.equal(liqBefore - ethers.parseUnits('1', 18));
  });

  it('si el boost de Reserva falla, el pago sigue y queda el evento', async () => {
    const { token, contract, owner, extra: padre, tokenAddr, signers } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await qualifyCollector(token, contract, padre);
    const hijo = signers[3];
    await registerAndFund(token, contract, hijo, '20', padre.address);
    await contract.connect(hijo).solicitarPrestamo(tokenAddr, 0);
    await contract
      .connect(hijo)
      .pagarPrestamo(tokenAddr, (await contract.obtenerDeuda(hijo.address)).total);
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await contract.connect(hijo).solicitarPrestamo(tokenAddr, 0);
    const debt = await contract.obtenerDeuda(hijo.address);
    const tx = await contract.connect(hijo).pagarPrestamo(tokenAddr, debt.total);
    const receipt = await tx.wait();
    const topic = ethers.id('ReservaBoostFallido(address,address,uint256)');
    expect(receipt.logs.some((log) => log.topics[0] === topic)).to.equal(true);
    expect((await contract.usuarios(hijo.address)).montoActivo).to.equal(0n);
  });
});
