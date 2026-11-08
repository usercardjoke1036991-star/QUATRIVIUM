const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployProtocol, seedPool, registerAndFund } = require('./helpers.cjs');

describe('QuatriviumCredit - Peg protection (Chainlink LUSD/USD 25h window)', function () {
  it('reverts loan request when peg is below threshold (0.98)', async () => {
    const { token, contract, owner, user, tokenAddr, feed } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await feed.updateAnswer(97_000_000);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
  });

  it('accepts oracle rounds up to 25 hours old (24h Arbitrum heartbeat + 1h margin) and reverts past 25h', async () => {
    const { token, contract, owner, user, tokenAddr, feed } = await deployProtocol();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);

    const block0 = await ethers.provider.getBlock('latest');
    const t0 = block0.timestamp;
    await feed.setRound(2, 100_000_000, t0, t0, 2);

    // Avanza 24 horas (86,400 s): dentro de la ventana de 25 horas (90,000 s)
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;

    const debt = await contract.obtenerDeuda(user.address);
    await contract.connect(user).pagarPrestamo(tokenAddr, debt.total);

    // Avanza 48h de cooldown; si la ronda tiene > 25h (25h + 10s), revierte
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60]);
    await ethers.provider.send('evm_mine');
    const block1 = await ethers.provider.getBlock('latest');
    const staleTs = block1.timestamp - (25 * 60 * 60 + 10);
    await feed.setRound(3, 100_000_000, staleTs, staleTs, 3);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;

    // Si la ronda tiene 24h de antigüedad (< 25h), vuelve a pasar
    const freshTs = block1.timestamp - 24 * 60 * 60;
    await feed.setRound(4, 100_000_000, freshTs, freshTs, 4);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });
});
