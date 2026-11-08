const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

function upsertEnvKey(filePath, key, value) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${key}=${value}\n`, 'utf8');
    return;
  }
  const original = fs.readFileSync(filePath, 'utf8');
  const lines = original.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    if (next.length === 0 || next[next.length - 1] !== '') {
      next.push(`${key}=${value}`);
    } else {
      next[next.length - 1] = `${key}=${value}`;
      next.push('');
    }
  }
  fs.writeFileSync(filePath, next.join('\n'), 'utf8');
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 97) {
    throw new Error(`seed-testnet solo corre en chain 97, actual=${Number(network.chainId)}`);
  }

  const Token = await ethers.getContractFactory('ERC20Mock');
  const Aggregator = await ethers.getContractFactory('MockV3Aggregator');
  const { getLinkedCreditFactory } = require('./linkCredit.cjs');
  const { deployFamaAndCredit } = require('../test/helpers.cjs');
  const QuatriviumCredit = await getLinkedCreditFactory(ethers);

  const token = await Token.deploy();
  await token.waitForDeployment();
  const feed = await Aggregator.deploy(8, 100000000);
  await feed.waitForDeployment();

  const tokenAddr = await token.getAddress();
  const feedAddr = await feed.getAddress();

  const { contract: protocol } = await deployFamaAndCredit(
    QuatriviumCredit,
    tokenAddr,
    feedAddr,
    deployer,
    500,
    [deployer.address],
    1
  );
  const protocolAddr = await protocol.getAddress();

  const mintAmount = ethers.parseUnits('10000', 18);
  const poolAmount = ethers.parseUnits('500', 18);
  await (await token.mint(deployer.address, mintAmount)).wait();
  await (await token.approve(protocolAddr, ethers.MaxUint256)).wait();
  await (await protocol.depositarLiquidez(tokenAddr, poolAmount)).wait();

  const envPath = path.join(__dirname, '..', '.env');
  upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET', protocolAddr);
  upsertEnvKey(envPath, 'EXPO_PUBLIC_USDT_ADDRESS', tokenAddr);
  upsertEnvKey(envPath, 'USDT_ADDRESS', tokenAddr);
  upsertEnvKey(envPath, 'USDT_FEED', feedAddr);

  const walletUsdt = await token.balanceOf(deployer.address);
  const poolUsdt = await token.balanceOf(protocolAddr);
  const liquidity = await protocol.totalLiquidity(tokenAddr);

  console.log('Network chainId:', Number(network.chainId));
  console.log('Deployer:', deployer.address);
  console.log('Mock USDT:', tokenAddr);
  console.log('Mock feed:', feedAddr);
  console.log('Quatrivium Finance (QuatriviumCredit):', protocolAddr);
  console.log('Wallet USDT:', ethers.formatUnits(walletUsdt, 18));
  console.log('Pool USDT:', ethers.formatUnits(poolUsdt, 18));
  console.log('totalLiquidity:', ethers.formatUnits(liquidity, 18));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
