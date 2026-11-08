const { expect } = require('chai');
const { ethers } = require('hardhat');
const { seedPool, registerAndFund, deployFamaAndCredit } = require('./helpers.cjs');

async function deployHarness() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user = signers[1];
  const extra = signers[2];
  const third = signers[3];
  const Token = await ethers.getContractFactory('ERC20Mock');
  const Aggregator = await ethers.getContractFactory('MockV3Aggregator');
  const { getLinkedCreditFactory } = require('../scripts/linkCredit.cjs');
  const Harness = await getLinkedCreditFactory(ethers, 'QuatriviumCreditHarness');
  const token = await Token.deploy();
  const feed = await Aggregator.deploy(8, 100000000);
  const tokenAddr = await token.getAddress();
  const { contract } = await deployFamaAndCredit(
    Harness,
    tokenAddr,
    await feed.getAddress(),
    owner,
    500,
    [owner.address],
    1
  );
  return { token, contract, owner, user, extra, third, tokenAddr, signers };
}

async function sellar(token, contract, user, tokenAddr, half = false) {
  const amt = half ? '0.5' : '1';
  await token.mint(user.address, ethers.parseUnits('2', 18));
  await token.connect(user).approve(await contract.getAddress(), ethers.MaxUint256);
  await contract.connect(user).pagarVerificacion(tokenAddr, ethers.parseUnits(amt, 18));
}

describe('QuatriviumCredit - el pool manda', function () {
  it('defaults to 80% utilization and does not racionar por conteo diario', async () => {
    const { token, contract, owner, user, extra, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await registerAndFund(token, contract, extra);
    expect(await contract.maxUtilizationBps()).to.equal(8000n);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 0);
    await expect(contract.connect(extra).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('blocks a large loan at 70% and still lets a 1 USDT small loan through', async () => {
    const { token, contract, owner, user, extra, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '85');
    await registerAndFund(token, contract, user, '80');
    await registerAndFund(token, contract, extra, '80');
    await contract.forceNivel(user.address, 8);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 8)).to.be.reverted;
    await expect(contract.connect(extra).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('lets a stamped first L1 through when general utilization is at 80%', async () => {
    const { token, contract, owner, user, extra, third, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '125');
    await registerAndFund(token, contract, user, '80');
    await registerAndFund(token, contract, extra, '80');
    await registerAndFund(token, contract, third, '80');
    await contract.forceNivel(user.address, 7);
    await contract.forceNivel(extra.address, 7);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 7);
    await contract.connect(extra).solicitarPrestamo(tokenAddr, 7);
    await expect(contract.connect(third).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
    await sellar(token, contract, third, tokenAddr);
    expect(await contract.reservaPrimera(third.address)).to.equal(ethers.parseUnits('1', 18));
    await expect(contract.connect(third).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
    expect(await contract.reservaPrimera(third.address)).to.equal(0n);
  });

  it('stamps on 0.50 + 0.50 verification', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '500');
    await registerAndFund(token, contract, user);
    await sellar(token, contract, user, tokenAddr, true);
    expect(await contract.reservaPrimera(user.address)).to.equal(0n);
    await sellar(token, contract, user, tokenAddr, true);
    expect(await contract.reservaPrimera(user.address)).to.equal(ethers.parseUnits('1', 18));
  });

  it('releases the stamp after 7 days so unused USDT returns to the general pool', async () => {
    const { token, contract, owner, user, extra, third, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '125');
    await registerAndFund(token, contract, user, '80');
    await registerAndFund(token, contract, extra, '80');
    await registerAndFund(token, contract, third, '80');
    await contract.forceNivel(user.address, 7);
    await contract.forceNivel(extra.address, 7);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 7);
    await contract.connect(extra).solicitarPrestamo(tokenAddr, 7);
    await sellar(token, contract, third, tokenAddr);
    await ethers.provider.send('evm_increaseTime', [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine');
    await contract.liberarSelloPrimeraSiExpiro(tokenAddr, third.address);
    expect(await contract.reservaPrimera(third.address)).to.equal(0n);
    await expect(contract.connect(third).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
  });

  it('after the first stamped loan, 48h and the 80% cap apply', async () => {
    const { token, contract, owner, user, extra, third, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '125');
    await registerAndFund(token, contract, user, '80');
    await registerAndFund(token, contract, extra, '80');
    await registerAndFund(token, contract, third, '80');
    await contract.forceNivel(user.address, 7);
    await contract.forceNivel(extra.address, 7);
    await contract.connect(user).solicitarPrestamo(tokenAddr, 7);
    await contract.connect(extra).solicitarPrestamo(tokenAddr, 7);
    await sellar(token, contract, third, tokenAddr);
    await contract.connect(third).solicitarPrestamo(tokenAddr, 0);
    await expect(contract.connect(third).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
    const deuda = await contract.obtenerDeuda(third.address);
    await token.mint(third.address, deuda.total);
    await contract.connect(third).pagarPrestamo(tokenAddr, deuda.total);
    await expect(contract.connect(third).solicitarPrestamo(tokenAddr, 0)).to.be.reverted;
    await ethers.provider.send('evm_increaseTime', [48 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(third).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });

  it('does not reopen a blocked large loan just because a day passed', async () => {
    const { token, contract, owner, user, extra, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '85');
    await registerAndFund(token, contract, user, '80');
    await registerAndFund(token, contract, extra, '80');
    await contract.forceNivel(user.address, 8);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 8)).to.be.reverted;
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine');
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 8)).to.be.reverted;
    await expect(contract.connect(extra).solicitarPrestamo(tokenAddr, 0)).to.not.be.reverted;
  });
});
