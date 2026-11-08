const { expect } = require('chai');
const { ethers } = require('hardhat');
const { seedPool, registerAndFund, assertNavInvariant } = require('./helpers.cjs');

async function deployHarness() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user = signers[1];
  const Token = await ethers.getContractFactory('ERC20Mock');
  const Aggregator = await ethers.getContractFactory('MockV3Aggregator');
  const { getLinkedCreditFactory } = require('../scripts/linkCredit.cjs');
  const { deployFamaAndCredit } = require('./helpers.cjs');
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
  return { token, contract, owner, user, tokenAddr, contractAddr: await contract.getAddress() };
}

describe('Reglas de dinero', function () {
  it('tras un hito la caja libre sigue en el 20% o más', async () => {
    const { token, contract, owner, user, tokenAddr, contractAddr } = await deployHarness();
    await seedPool(token, contract, owner, '8000');
    await token.mint(owner.address, ethers.parseUnits('20000', 18));
    await token.connect(owner).approve(contractAddr, ethers.MaxUint256);
    await contract.connect(owner).depositarLiquidez(tokenAddr, ethers.parseUnits('12000', 18));
    await registerAndFund(token, contract, user);
    await contract.forceNivel(user.address, 100);
    await contract.connect(user).cobrarBonoHito(tokenAddr);
    const liq = await contract.totalLiquidity(tokenAddr);
    const out = await contract.outstandingLoans(tokenAddr);
    const caja = liq > out ? liq - out : 0n;
    expect(caja).to.be.gte((liq * 2000n) / 10000n);
    await assertNavInvariant(token, contract, tokenAddr, contractAddr);
  });

  it('un préstamo no deja el uso por encima del 80%', async () => {
    const { token, contract, owner, user, tokenAddr } = await deployHarness();
    await seedPool(token, contract, owner, '100');
    await registerAndFund(token, contract, user, '80');
    await contract.forceNivel(user.address, 10);
    await expect(contract.connect(user).solicitarPrestamo(tokenAddr, 10)).to.be.reverted;
  });
});
