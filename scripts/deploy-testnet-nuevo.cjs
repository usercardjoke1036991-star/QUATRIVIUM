/**
 * Despliega el protocolo NUEVO en BSC testnet (97): FamaLib, FamaCaja, Credit, Reserva, Alta.
 * No toca mainnet. No parchea el Demo viejo 0xD2d2.
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const { BSC_TESTNET, isHexAddress, isZero } = require('./bscNetworks.cjs');
const { getLinkedCreditFactory } = require('./linkCredit.cjs');

const LEGACY_DEMO = '0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f';

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
    if (next.length === 0 || next[next.length - 1] !== '') next.push(`${key}=${value}`);
    else {
      next[next.length - 1] = `${key}=${value}`;
      next.push('');
    }
  }
  fs.writeFileSync(filePath, next.join('\n'), 'utf8');
}

function parseAdmins(deployerAddress) {
  const raw = process.env.ADMINS || '';
  const fromEnv = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^0x[0-9a-fA-F]{40}$/.test(item));
  const unique = [...new Set(fromEnv.map((addr) => addr.toLowerCase()))];
  const admins = unique.length > 0 ? unique : [deployerAddress];
  const confirms = Math.min(
    Math.max(
      Number.parseInt(process.env.REQUIRED_CONFIRMATIONS || (admins.length > 1 ? '2' : '1'), 10),
      1
    ),
    admins.length
  );
  return { admins, confirms };
}

function writeKnown(addresses) {
  const knownPath = path.join(__dirname, '..', 'constants', 'deployedAddresses.ts');
  let source = fs.readFileSync(knownPath, 'utf8');
  source = source.replace(
    /export const DEPLOYED_TESTNET = \{[\s\S]*?\} as const;/,
    `export const DEPLOYED_TESTNET = {
  chainId: 97,
  contract: '${addresses.credit}',
  usdt: '${addresses.usdt}',
  reserva: '${addresses.reserva}',
  fama: '${addresses.fama}',
  alta: '${addresses.alta}',
  startBlock: ${addresses.startBlock},
} as const;`
  );
  if (!source.includes('LEGACY_DEMO_TESTNET')) {
    source = source.replace(
      '/** Direcciones públicas ya desplegadas. Mainnet se rellena tras `npm run deploy:bsc`. */\n',
      `/** Direcciones públicas ya desplegadas. Mainnet se rellena tras \`npm run deploy:bsc\`. */\n/** Demo legado en Chapel. No parchear. */\nexport const LEGACY_DEMO_TESTNET = '${LEGACY_DEMO}' as const;\n\n`
    );
  }
  fs.writeFileSync(knownPath, source, 'utf8');
}

function writeEas(addresses) {
  const easPath = path.join(__dirname, '..', 'eas.json');
  if (!fs.existsSync(easPath)) return;
  const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
  for (const profile of ['development', 'preview']) {
    if (!eas.build?.[profile]?.env) continue;
    eas.build[profile].env.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET = addresses.credit;
    eas.build[profile].env.EXPO_PUBLIC_CONTRACT_START_BLOCK = String(addresses.startBlock);
    eas.build[profile].env.EXPO_PUBLIC_USDT_ADDRESS = addresses.usdt;
    eas.build[profile].env.EXPO_PUBLIC_FAMA_ADDRESS_TESTNET = addresses.fama;
    eas.build[profile].env.EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET = addresses.reserva;
    eas.build[profile].env.EXPO_PUBLIC_ALTA_ADDRESS_TESTNET = addresses.alta;
  }
  fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n', 'utf8');
}

async function main() {
  if (process.env.CONFIRM_MAINNET === 'yes') {
    throw new Error('Este script es solo testnet. Quita CONFIRM_MAINNET=yes.');
  }
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 97) {
    throw new Error(`Solo BSC testnet (97). chainId=${chainId}`);
  }

  const usdt = process.env.USDT_ADDRESS || BSC_TESTNET.usdt;
  const usdtFeed = process.env.USDT_FEED || BSC_TESTNET.usdtUsdFeed;
  const feeCollector = process.env.FEE_COLLECTOR || deployer.address;
  const feeBp = Number(process.env.FEE_BP || '500');
  const { admins, confirms } = parseAdmins(deployer.address);
  if (!isHexAddress(usdt) || isZero(usdt)) throw new Error('USDT inválido');
  if (!isHexAddress(usdtFeed) || isZero(usdtFeed)) throw new Error('USDT_FEED inválido');
  if (!isHexAddress(feeCollector) || isZero(feeCollector))
    throw new Error('FEE_COLLECTOR inválido');

  const usdtCode = await ethers.provider.getCode(usdt);
  const feedCode = await ethers.provider.getCode(usdtFeed);
  if (!usdtCode || usdtCode === '0x') throw new Error(`USDT sin bytecode: ${usdt}`);
  if (!feedCode || feedCode === '0x') throw new Error(`Feed sin bytecode: ${usdtFeed}`);

  const bnb = await ethers.provider.getBalance(deployer.address);
  if (bnb < ethers.parseUnits('0.01', 18)) {
    throw new Error('BNB de testnet insuficiente (< 0.01).');
  }

  const QuatriviumCredit = await getLinkedCreditFactory(ethers);
  const artifact = await hre.artifacts.readArtifact('QuatriviumCredit');
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  if (runtimeBytes > 24576) {
    throw new Error(`Credit mide ${runtimeBytes} bytes y no cabe en EIP-170.`);
  }

  console.log('chainId', chainId);
  console.log('deployer', deployer.address);
  console.log('FamaLib', QuatriviumCredit.famaLibAddress);
  console.log('Credit runtime', runtimeBytes);
  console.log('USDT', usdt);
  console.log('feed', usdtFeed);
  console.log('feeCollector', feeCollector);
  console.log('admins', admins);
  console.log('confirms', confirms);
  console.log('legacyDemo', LEGACY_DEMO);

  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  const creditAddr = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const FamaCaja = await ethers.getContractFactory('QuatriviumFamaCaja');
  const fama = await FamaCaja.deploy(usdt, creditAddr);
  await fama.waitForDeployment();
  const famaAddr = await fama.getAddress();

  const credit = await QuatriviumCredit.deploy(
    usdt,
    usdtFeed,
    feeCollector,
    feeBp,
    admins,
    confirms,
    famaAddr
  );
  await credit.waitForDeployment();
  const deployedCredit = await credit.getAddress();
  if (deployedCredit.toLowerCase() !== creditAddr.toLowerCase()) {
    throw new Error(`Credit previsto ${creditAddr} vs ${deployedCredit}`);
  }
  const deployTx = credit.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const startBlock = receipt?.blockNumber || 0;

  const Reserva = await ethers.getContractFactory('QuatriviumReserva');
  const reserva = await Reserva.deploy(usdt, await credit.fundador(), deployedCredit, famaAddr);
  await reserva.waitForDeployment();
  const reservaAddr = await reserva.getAddress();

  const Alta = await ethers.getContractFactory('QuatriviumAlta');
  const alta = await Alta.deploy(usdt, deployedCredit, reservaAddr);
  await alta.waitForDeployment();
  const altaAddr = await alta.getAddress();

  const fundador = await credit.fundador();
  if (deployer.address.toLowerCase() === fundador.toLowerCase()) {
    await (await fama.setAlta(altaAddr)).wait();
    await (await fama.setReserva(reservaAddr)).wait();
  } else {
    console.warn('setAlta/setReserva omitidos: el deployer no es fundador', fundador);
  }
  await (await reserva.setAltaFuente(altaAddr)).wait();

  if (process.env.SEED_POOL !== 'no') {
    const seedAmount = ethers.parseUnits(process.env.SEED_POOL || '500', 18);
    try {
      const token = await ethers.getContractAt('ERC20Mock', usdt);
      await (await token.mint(deployer.address, seedAmount)).wait();
      await (await token.approve(deployedCredit, seedAmount)).wait();
      await (await credit.depositarLiquidez(usdt, seedAmount)).wait();
      console.log('pool sembrado', ethers.formatUnits(seedAmount, 18));
    } catch (error) {
      console.warn('Seed pool omitido:', error.shortMessage || error.message || error);
    }
  }

  const addresses = {
    credit: deployedCredit,
    fama: famaAddr,
    reserva: reservaAddr,
    alta: altaAddr,
    usdt,
    startBlock,
  };
  writeKnown(addresses);
  writeEas(addresses);

  const envPath = path.join(__dirname, '..', '.env');
  upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET', deployedCredit);
  upsertEnvKey(envPath, 'EXPO_PUBLIC_FAMA_ADDRESS_TESTNET', famaAddr);
  upsertEnvKey(envPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET', reservaAddr);
  upsertEnvKey(envPath, 'EXPO_PUBLIC_ALTA_ADDRESS_TESTNET', altaAddr);
  if (startBlock) upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_START_BLOCK', String(startBlock));
  const workerPath = path.join(__dirname, '..', '.env.worker');
  if (fs.existsSync(workerPath)) {
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET', deployedCredit);
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_FAMA_ADDRESS_TESTNET', famaAddr);
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET', reservaAddr);
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_ALTA_ADDRESS_TESTNET', altaAddr);
  }

  console.log('QuatriviumCredit', deployedCredit);
  console.log('QuatriviumFamaCaja', famaAddr);
  console.log('QuatriviumReserva', reservaAddr);
  console.log('QuatriviumAlta', altaAddr);
  console.log('startBlock', startBlock);
  console.log('fama.alta', await fama.alta());
  console.log('reserva.altaFuente', await reserva.altaFuente());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
