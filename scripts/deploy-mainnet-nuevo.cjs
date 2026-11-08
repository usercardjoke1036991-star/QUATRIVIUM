/**
 * Despliega el protocolo completo en Arbitrum One mainnet (chainId: 42161) con LUSD:
 * FamaLib, FamaCaja, Credit, Reserva, Alta.
 * No corre si CONFIRM_MAINNET no es yes. No toca las direcciones de la red 97.
 * No siembra la caja: el alta de 4 LUSD reserva el primer préstamo de 1.
 *
 * Referencia Ethereum Mainnet (chainId: 1):
 * - LUSD (18 decimales): 0x5f98805A4E8be255a32880FDeC7F6728C6568bA0
 * - Chainlink LUSD/USD:  0x3D7aE7E594f2f2091Ad8798313450130d0Aba3a0
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const { ARBITRUM_MAINNET, BSC_TESTNET, isHexAddress, isZero } = require('./bscNetworks.cjs');

const FOUNDER = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';
const GAS_FLOOR = ethers.parseEther('0.002');

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
    .filter((item) => isHexAddress(item) && !isZero(item));
  const unique = [...new Set(fromEnv.map((addr) => addr.toLowerCase()))];
  const admins = unique.length > 0 ? unique : [deployerAddress];
  const confirms = Math.min(
    Math.max(Number.parseInt(process.env.REQUIRED_CONFIRMATIONS || '2', 10), 1),
    admins.length
  );
  return { admins, confirms };
}

function writeKnown(addresses) {
  const knownPath = path.join(__dirname, '..', 'constants', 'deployedAddresses.ts');
  let source = fs.readFileSync(knownPath, 'utf8');
  source = source.replace(
    /export const DEPLOYED_MAINNET = \{[\s\S]*?\} as const;/,
    `export const DEPLOYED_MAINNET = {
  chainId: 42161,
  contract: '${addresses.credit}',
  usdt: '${addresses.usdt}',
  reserva: '${addresses.reserva}',
  fama: '${addresses.fama}',
  alta: '${addresses.alta}',
  /** Billetera personal Real (donaciones). */
  founder: '${FOUNDER}',
  startBlock: ${addresses.startBlock},
} as const;`
  );
  fs.writeFileSync(knownPath, source, 'utf8');
}

function writeEas(addresses) {
  const easPath = path.join(__dirname, '..', 'eas.json');
  if (!fs.existsSync(easPath)) return;
  const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
  const env = eas.build?.production?.env;
  if (!env) return;
  env.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET = addresses.credit;
  env.EXPO_PUBLIC_FAMA_ADDRESS_MAINNET = addresses.fama;
  env.EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET = addresses.reserva;
  env.EXPO_PUBLIC_ALTA_ADDRESS_MAINNET = addresses.alta;
  env.EXPO_PUBLIC_CONTRACT_START_BLOCK = String(addresses.startBlock);
  env.EXPO_PUBLIC_USDT_ADDRESS = addresses.usdt;
  fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n', 'utf8');
}

async function assertFeedLive(feed) {
  const oracle = new ethers.Contract(
    feed,
    [
      'function decimals() view returns (uint8)',
      'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
    ],
    ethers.provider
  );
  const decimals = Number(await oracle.decimals());
  if (decimals < 2 || decimals > 18)
    throw new Error(`Feed con decimales fuera de rango: ${decimals}`);
  const [roundId, price, startedAt, updatedAt, answeredInRound] = await oracle.latestRoundData();
  if (price <= 0n) throw new Error('Feed sin precio.');
  const threshold = 98n * 10n ** BigInt(decimals - 2);
  if (price < threshold) throw new Error('Feed bajo 0.98. No se despliega.');
  const block = await ethers.provider.getBlock('latest');
  const now = BigInt(block.timestamp);
  if (updatedAt <= 0n || now - updatedAt > 25n * 3600n)
    throw new Error('Feed con más de 25 horas. No se despliega.');
  if (roundId <= 0n || answeredInRound !== roundId) throw new Error('Feed con ronda incoherente.');
  if (startedAt <= 0n || startedAt > updatedAt)
    throw new Error('Feed con marca de tiempo incoherente.');
}

async function main() {
  if (process.env.CONFIRM_MAINNET !== 'yes') {
    throw new Error('Mainnet bloqueada. CONFIRM_MAINNET=yes solo el minuto del despliegue.');
  }
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 42161) throw new Error(`Solo Arbitrum One mainnet (42161). chainId=${chainId}`);

  const envUsdt = (process.env.USDT_ADDRESS || process.env.LUSD_ADDRESS || '').toLowerCase();
  const testnetUsdt = new Set([
    BSC_TESTNET.usdt.toLowerCase(),
    '0x2d4ae5e6984d98777a24473f196326ff2604f5a6',
  ]);
  if (envUsdt && envUsdt !== ARBITRUM_MAINNET.lusd.toLowerCase()) {
    if (!testnetUsdt.has(envUsdt)) {
      throw new Error(`LUSD/USDT_ADDRESS no es el LUSD de Arbitrum One. Recibido ${envUsdt}`);
    }
    console.warn('Token de la red de prueba ignorado. Mainnet usa el LUSD oficial en Arbitrum One.');
  }
  const usdt = ARBITRUM_MAINNET.lusd;
  const usdtFeed = ARBITRUM_MAINNET.lusdUsdFeed;
  const envFeed = (process.env.USDT_FEED || process.env.LUSD_FEED || '').toLowerCase();
  if (envFeed && envFeed !== usdtFeed.toLowerCase()) {
    console.warn('Feed del entorno ignorado. Mainnet usa el feed LUSD/USD de Chainlink en Arbitrum One.');
  }
  const feeCollector = process.env.FEE_COLLECTOR || '';
  const feeBp = Number(process.env.FEE_BP || '500');
  const { admins, confirms } = parseAdmins(deployer.address);

  if (!isHexAddress(feeCollector) || isZero(feeCollector))
    throw new Error('FEE_COLLECTOR explícito obligatorio.');
  if (admins.length < 2 || confirms < 2)
    throw new Error('Mainnet exige dos admins y dos confirmaciones.');
  if (admins[0].toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error('La primera admin tiene que ser la billetera que despliega.');
  }
  if (feeBp < 0 || feeBp > 1000) throw new Error('FEE_BP fuera de rango.');

  const usdtCode = await ethers.provider.getCode(usdt);
  const feedCode = await ethers.provider.getCode(usdtFeed);
  if (!usdtCode || usdtCode === '0x') throw new Error(`USDT sin bytecode: ${usdt}`);
  if (!feedCode || feedCode === '0x') throw new Error(`Feed sin bytecode: ${usdtFeed}`);
  await assertFeedLive(usdtFeed);

  const bnb = await ethers.provider.getBalance(deployer.address);
  if (bnb < GAS_FLOOR) {
    throw new Error(
      `BNB insuficiente para el colchón de gas: hay ${ethers.formatEther(bnb)}, hacen falta 0.03.`
    );
  }

  const { getLinkedCreditFactory } = require('./linkCredit.cjs');
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
  console.log('pool', 'vacío hasta depósitos. El alta reserva el primer préstamo de 1 USDT.');

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

  await (await fama.setAlta(altaAddr)).wait();
  await (await fama.setReserva(reservaAddr)).wait();
  await (await reserva.setAltaFuente(altaAddr)).wait();

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
  upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET', deployedCredit);
  upsertEnvKey(envPath, 'EXPO_PUBLIC_FAMA_ADDRESS_MAINNET', famaAddr);
  upsertEnvKey(envPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET', reservaAddr);
  upsertEnvKey(envPath, 'EXPO_PUBLIC_ALTA_ADDRESS_MAINNET', altaAddr);
  const workerPath = path.join(__dirname, '..', '.env.worker');
  if (fs.existsSync(workerPath)) {
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET', deployedCredit);
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_FAMA_ADDRESS_MAINNET', famaAddr);
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET', reservaAddr);
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_ALTA_ADDRESS_MAINNET', altaAddr);
  }

  console.log('QuatriviumCredit', deployedCredit);
  console.log('QuatriviumFamaCaja', famaAddr);
  console.log('QuatriviumReserva', reservaAddr);
  console.log('QuatriviumAlta', altaAddr);
  console.log('startBlock', startBlock);
  console.log('fama.alta', await fama.alta());
  console.log('reserva.altaFuente', await reserva.altaFuente());
  console.log('La red del teléfono de desarrollo no se cambió. Sigue en la 97.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
