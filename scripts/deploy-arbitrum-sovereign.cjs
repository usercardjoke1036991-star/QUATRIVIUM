/**
 * Script Maestro de Despliegue Soberano — Quatrivium Sovereign
 * Soporta Arbitrum One Mainnet (chainId: 42161) y Arbitrum Sepolia Testnet (chainId: 421614).
 *
 * Flujo automatizado en orden:
 *  a) Desplegar QuatriviumFamaLib.
 *  b) Enlazar y desplegar QuatriviumCredit apuntando a LUSD
 *     (0x93b346b6BC2548dA6A1E7d98E9a421B42541425b) y al oráculo Chainlink LUSD/USD
 *     (0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF).
 *  c) Desplegar QuatriviumAlta, QuatriviumFamaCaja y QuatriviumReserva.
 *  d) Ejecutar las transacciones de enlace cruzado entre los contratos hermanos y QuatriviumCredit:
 *     - fama.setAlta(altaAddr)
 *     - fama.setReserva(reservaAddr)
 *     - reserva.setAltaFuente(altaAddr)
 *  e) Escribir automáticamente las direcciones recién desplegadas en constants/deployedAddresses.ts,
 *     actualizar eas.json y guardar un resumen JSON del despliegue en deployments/.
 *
 * Uso futuro (NO ejecutar hasta que se autorice el despliegue):
 *  - Arbitrum One (42161):     CONFIRM_MAINNET=yes npm run deploy:arbitrum
 *  - Arbitrum Sepolia (421614): npm run deploy:arbitrum:sepolia
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const { ARBITRUM_MAINNET, isHexAddress, isZero } = require('./bscNetworks.cjs');
const { getLinkedCreditFactory } = require('./linkCredit.cjs');

const FOUNDER = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';
const ARBITRUM_ONE_CHAIN_ID = 42161;
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const LUSD_ARBITRUM_ONE = '0x93b346b6BC2548dA6A1E7d98E9a421B42541425b';
const CHAINLINK_LUSD_USD_ARBITRUM_ONE = '0x0411D28c94d85A36bC72Cb0f875dfA8371D8fFfF';
const GAS_FLOOR_MAINNET = ethers.parseEther('0.002');
const GAS_FLOOR_TESTNET = ethers.parseEther('0.0005');

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

function parseAdmins(deployerAddress, isMainnet) {
  const raw = process.env.ADMINS || '';
  const fromEnv = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => isHexAddress(item) && !isZero(item));
  const unique = [...new Set(fromEnv.map((addr) => addr.toLowerCase()))];
  const admins = unique.length > 0 ? unique : [deployerAddress];
  const defaultConfirms = isMainnet || admins.length > 1 ? '2' : '1';
  const confirms = Math.min(
    Math.max(Number.parseInt(process.env.REQUIRED_CONFIRMATIONS || defaultConfirms, 10), 1),
    admins.length
  );
  return { admins, confirms };
}

function updateDeployedAddressesTs(addresses, isMainnet) {
  const knownPath = path.join(__dirname, '..', 'constants', 'deployedAddresses.ts');
  let source = fs.readFileSync(knownPath, 'utf8');
  if (isMainnet) {
    source = source.replace(
      /export const DEPLOYED_MAINNET = \{[\s\S]*?\} as const;/,
      `export const DEPLOYED_MAINNET = {
  chainId: 42161,
  contract: '${addresses.credit}',
  usdt: '${addresses.lusd}',
  reserva: '${addresses.reserva}',
  fama: '${addresses.fama}',
  alta: '${addresses.alta}',
  /** Billetera personal Real (donaciones). */
  founder: '${FOUNDER}',
  startBlock: ${addresses.startBlock},
} as const;`
    );
  } else {
    source = source.replace(
      /export const DEPLOYED_TESTNET = \{[\s\S]*?\} as const;/,
      `export const DEPLOYED_TESTNET = {
  chainId: 421614,
  contract: '${addresses.credit}',
  usdt: '${addresses.lusd}',
  reserva: '${addresses.reserva}',
  fama: '${addresses.fama}',
  alta: '${addresses.alta}',
  startBlock: ${addresses.startBlock},
} as const;`
    );
  }
  fs.writeFileSync(knownPath, source, 'utf8');
}

function updateEasJson(addresses, isMainnet) {
  const easPath = path.join(__dirname, '..', 'eas.json');
  if (!fs.existsSync(easPath)) return;
  const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
  if (isMainnet) {
    const env = eas.build?.production?.env;
    if (env) {
      env.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET = addresses.credit;
      env.EXPO_PUBLIC_FAMA_ADDRESS_MAINNET = addresses.fama;
      env.EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET = addresses.reserva;
      env.EXPO_PUBLIC_ALTA_ADDRESS_MAINNET = addresses.alta;
      env.EXPO_PUBLIC_CONTRACT_START_BLOCK = String(addresses.startBlock);
      env.EXPO_PUBLIC_USDT_ADDRESS = addresses.lusd;
    }
  } else {
    for (const profile of ['development', 'preview']) {
      const env = eas.build?.[profile]?.env;
      if (!env) continue;
      env.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET = addresses.credit;
      env.EXPO_PUBLIC_FAMA_ADDRESS_TESTNET = addresses.fama;
      env.EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET = addresses.reserva;
      env.EXPO_PUBLIC_ALTA_ADDRESS_TESTNET = addresses.alta;
      env.EXPO_PUBLIC_CONTRACT_START_BLOCK = String(addresses.startBlock);
      env.EXPO_PUBLIC_USDT_ADDRESS = addresses.lusd;
    }
  }
  fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n', 'utf8');
}

function writeDeploymentSummaryJson(summary) {
  const dir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const networkTag = summary.chainId === ARBITRUM_ONE_CHAIN_ID ? 'arbitrum-one' : 'arbitrum-sepolia';
  const fileByNetwork = path.join(dir, `arbitrum-sovereign-${networkTag}.json`);
  const fileByChainId = path.join(dir, `arbitrum-sovereign-${summary.chainId}.json`);
  const payload = JSON.stringify(summary, null, 2) + '\n';
  fs.writeFileSync(fileByNetwork, payload, 'utf8');
  fs.writeFileSync(fileByChainId, payload, 'utf8');
  return fileByNetwork;
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
  if (decimals < 2 || decimals > 18) {
    throw new Error(`Feed con decimales fuera de rango: ${decimals}`);
  }
  const [roundId, price, startedAt, updatedAt, answeredInRound] = await oracle.latestRoundData();
  if (price <= 0n) throw new Error('Feed Chainlink LUSD/USD sin precio válido.');
  const threshold = 98n * 10n ** BigInt(decimals - 2);
  if (price < threshold) throw new Error('Feed LUSD/USD bajo 0.98 USD. No se despliega.');
  const block = await ethers.provider.getBlock('latest');
  const now = BigInt(block.timestamp);
  if (updatedAt <= 0n || now - updatedAt > 25n * 3600n) {
    throw new Error('Feed Chainlink LUSD/USD con más de 25 horas sin actualizar. No se despliega.');
  }
  if (roundId <= 0n || answeredInRound !== roundId) {
    throw new Error('Feed Chainlink LUSD/USD con ronda incoherente.');
  }
  if (startedAt <= 0n || startedAt > updatedAt) {
    throw new Error('Feed Chainlink LUSD/USD con marca de tiempo incoherente.');
  }
}

async function resolveTokensAndFeeds(chainId, isMainnet) {
  if (isMainnet) {
    const lusd = ARBITRUM_MAINNET.lusd || LUSD_ARBITRUM_ONE;
    const lusdFeed = ARBITRUM_MAINNET.lusdUsdFeed || CHAINLINK_LUSD_USD_ARBITRUM_ONE;
    const lusdCode = await ethers.provider.getCode(lusd);
    const feedCode = await ethers.provider.getCode(lusdFeed);
    if (!lusdCode || lusdCode === '0x') {
      throw new Error(`LUSD sin bytecode en Arbitrum One: ${lusd}`);
    }
    if (!feedCode || feedCode === '0x') {
      throw new Error(`Oráculo Chainlink LUSD/USD sin bytecode en Arbitrum One: ${lusdFeed}`);
    }
    await assertFeedLive(lusdFeed);
    return { lusd, lusdFeed };
  }

  let lusd = process.env.LUSD_ADDRESS || process.env.USDT_ADDRESS || '';
  let lusdFeed = process.env.LUSD_FEED || process.env.USDT_FEED || '';

  if (!isHexAddress(lusd) || isZero(lusd)) {
    const ERC20Mock = await ethers.getContractFactory('ERC20Mock');
    const mockToken = await ERC20Mock.deploy('Liquity USD (Sepolia)', 'LUSD', 18);
    await mockToken.waitForDeployment();
    lusd = await mockToken.getAddress();
  }
  if (!isHexAddress(lusdFeed) || isZero(lusdFeed)) {
    const AggregatorMock = await ethers.getContractFactory('MockV3Aggregator');
    const mockFeed = await AggregatorMock.deploy(8, 100000000n);
    await mockFeed.waitForDeployment();
    lusdFeed = await mockFeed.getAddress();
  }

  const lusdCode = await ethers.provider.getCode(lusd);
  const feedCode = await ethers.provider.getCode(lusdFeed);
  if (!lusdCode || lusdCode === '0x') {
    throw new Error(`Token LUSD de prueba sin bytecode en Arbitrum Sepolia (${chainId}): ${lusd}`);
  }
  if (!feedCode || feedCode === '0x') {
    throw new Error(`Feed LUSD/USD de prueba sin bytecode en Arbitrum Sepolia (${chainId}): ${lusdFeed}`);
  }
  return { lusd, lusdFeed };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== ARBITRUM_ONE_CHAIN_ID && chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Red no soportada (chainId=${chainId}). Use Arbitrum One (42161) o Arbitrum Sepolia (421614).`
    );
  }

  const isMainnet = chainId === ARBITRUM_ONE_CHAIN_ID;
  if (isMainnet && process.env.CONFIRM_MAINNET !== 'yes') {
    throw new Error('Mainnet bloqueada. Defina CONFIRM_MAINNET=yes solo en el momento del despliegue.');
  }
  if (!isMainnet && process.env.CONFIRM_MAINNET === 'yes') {
    throw new Error('Arbitrum Sepolia es testnet. No ejecute con CONFIRM_MAINNET=yes.');
  }

  const feeCollector = process.env.FEE_COLLECTOR || (isMainnet ? '' : deployer.address);
  const feeBp = Number(process.env.FEE_BP || '500');
  const { admins, confirms } = parseAdmins(deployer.address, isMainnet);

  if (!isHexAddress(feeCollector) || isZero(feeCollector)) {
    throw new Error('FEE_COLLECTOR explícito obligatorio.');
  }
  if (isMainnet && (admins.length < 2 || confirms < 2)) {
    throw new Error('Arbitrum One mainnet exige al menos dos admins y dos confirmaciones.');
  }
  if (admins[0].toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error('La primera admin debe coincidir con la billetera deployer.');
  }
  if (feeBp < 0 || feeBp > 1000) {
    throw new Error('FEE_BP fuera de rango (0..1000).');
  }

  const ethBalance = await ethers.provider.getBalance(deployer.address);
  const minGas = isMainnet ? GAS_FLOOR_MAINNET : GAS_FLOOR_TESTNET;
  if (ethBalance < minGas) {
    throw new Error(
      `ETH insuficiente en Arbitrum (${chainId}): saldo=${ethers.formatEther(ethBalance)} ETH, requerido=${ethers.formatEther(minGas)} ETH.`
    );
  }

  const { lusd, lusdFeed } = await resolveTokensAndFeeds(chainId, isMainnet);

  // a) Desplegar QuatriviumFamaLib y enlazar con QuatriviumCredit
  const QuatriviumCredit = await getLinkedCreditFactory(ethers);
  const famaLibAddr = QuatriviumCredit.famaLibAddress;
  const artifact = await hre.artifacts.readArtifact('QuatriviumCredit');
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  if (runtimeBytes > 24576) {
    throw new Error(`QuatriviumCredit mide ${runtimeBytes} bytes y excede el límite EIP-170 (24576).`);
  }

  console.log('=== QUATRIVIUM SOVEREIGN — DESPLIEGUE EN ARBITRUM ===');
  console.log('chainId:', chainId, isMainnet ? '(Arbitrum One Mainnet)' : '(Arbitrum Sepolia Testnet)');
  console.log('deployer:', deployer.address);
  console.log('LUSD:', lusd);
  console.log('Chainlink LUSD/USD:', lusdFeed);
  console.log('QuatriviumFamaLib:', famaLibAddr);
  console.log('QuatriviumCredit runtime bytes:', runtimeBytes);
  console.log('feeCollector:', feeCollector);
  console.log('admins:', admins);
  console.log('confirms:', confirms);

  // b) y c) Predecir dirección de QuatriviumCredit, desplegar QuatriviumFamaCaja, QuatriviumCredit, QuatriviumReserva y QuatriviumAlta
  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  const predictedCreditAddr = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });

  const FamaCaja = await ethers.getContractFactory('QuatriviumFamaCaja');
  const fama = await FamaCaja.deploy(lusd, predictedCreditAddr);
  await fama.waitForDeployment();
  const famaAddr = await fama.getAddress();

  const credit = await QuatriviumCredit.deploy(
    lusd,
    lusdFeed,
    feeCollector,
    feeBp,
    admins,
    confirms,
    famaAddr
  );
  await credit.waitForDeployment();
  const deployedCredit = await credit.getAddress();
  if (deployedCredit.toLowerCase() !== predictedCreditAddr.toLowerCase()) {
    throw new Error(
      `Dirección de QuatriviumCredit prevista (${predictedCreditAddr}) no coincide con la desplegada (${deployedCredit}).`
    );
  }

  const deployTx = credit.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const startBlock = receipt?.blockNumber || 0;

  const fundador = await credit.fundador();

  const Reserva = await ethers.getContractFactory('QuatriviumReserva');
  const reserva = await Reserva.deploy(lusd, fundador, deployedCredit, famaAddr);
  await reserva.waitForDeployment();
  const reservaAddr = await reserva.getAddress();

  const Alta = await ethers.getContractFactory('QuatriviumAlta');
  const alta = await Alta.deploy(lusd, deployedCredit, reservaAddr);
  await alta.waitForDeployment();
  const altaAddr = await alta.getAddress();

  // d) Ejecutar las transacciones de enlace cruzado entre los contratos hermanos y QuatriviumCredit
  await (await fama.setAlta(altaAddr)).wait();
  await (await fama.setReserva(reservaAddr)).wait();
  await (await reserva.setAltaFuente(altaAddr)).wait();

  // e) Escribir direcciones en constants/deployedAddresses.ts, eas.json, .env y resumen JSON
  const addresses = {
    credit: deployedCredit,
    fama: famaAddr,
    reserva: reservaAddr,
    alta: altaAddr,
    famaLib: famaLibAddr,
    lusd,
    lusdFeed,
    startBlock,
  };

  updateDeployedAddressesTs(addresses, isMainnet);
  updateEasJson(addresses, isMainnet);

  const envPath = path.join(__dirname, '..', '.env');
  if (isMainnet) {
    upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET', deployedCredit);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_FAMA_ADDRESS_MAINNET', famaAddr);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET', reservaAddr);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_ALTA_ADDRESS_MAINNET', altaAddr);
  } else {
    upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET', deployedCredit);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_FAMA_ADDRESS_TESTNET', famaAddr);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET', reservaAddr);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_ALTA_ADDRESS_TESTNET', altaAddr);
  }

  const summary = {
    protocol: 'Quatrivium Sovereign',
    network: isMainnet ? 'arbitrumOne' : 'arbitrumSepolia',
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    founder: fundador,
    feeCollector,
    feeBasisPoints: feeBp,
    admins,
    requiredConfirmations: confirms,
    startBlock,
    tokens: {
      lusd,
      chainlinkLusdUsdFeed: lusdFeed,
    },
    contracts: {
      QuatriviumFamaLib: famaLibAddr,
      QuatriviumCredit: deployedCredit,
      QuatriviumFamaCaja: famaAddr,
      QuatriviumReserva: reservaAddr,
      QuatriviumAlta: altaAddr,
    },
    crossLinks: {
      'fama.credit': await fama.credit(),
      'fama.alta': await fama.alta(),
      'fama.reserva': await fama.reserva(),
      'reserva.altaFuente': await reserva.altaFuente(),
    },
  };

  const summaryPath = writeDeploymentSummaryJson(summary);

  console.log('QuatriviumFamaLib:', famaLibAddr);
  console.log('QuatriviumCredit:', deployedCredit);
  console.log('QuatriviumFamaCaja:', famaAddr);
  console.log('QuatriviumReserva:', reservaAddr);
  console.log('QuatriviumAlta:', altaAddr);
  console.log('startBlock:', startBlock);
  console.log('fama.alta:', summary.crossLinks['fama.alta']);
  console.log('fama.reserva:', summary.crossLinks['fama.reserva']);
  console.log('reserva.altaFuente:', summary.crossLinks['reserva.altaFuente']);
  console.log('Resumen JSON guardado en:', summaryPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
