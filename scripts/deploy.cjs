const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const { BSC_MAINNET, BSC_TESTNET, isHexAddress, isZero } = require('./bscNetworks.cjs');
const { getLinkedCreditFactory } = require('./linkCredit.cjs');

const TESTNET_ONLY_USDT = new Set([
  BSC_TESTNET.usdt.toLowerCase(),
  '0x2d4ae5e6984d98777a24473f196326ff2604f5a6',
]);

function parseAdmins(deployerAddress) {
  const raw = process.env.ADMINS || '';
  const fromEnv = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^0x[0-9a-fA-F]{40}$/.test(item));
  const unique = [...new Set(fromEnv.map((addr) => addr.toLowerCase()))];
  if (process.env.CONFIRM_MAINNET === 'yes' && unique.length < 1) {
    throw new Error(
      'Mainnet exige ADMINS explícito (al menos la fundadora). No se usa el deployer por omisión.'
    );
  }
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

function writeTestnetKnownAddress(address, usdt, startBlock, famaAddr) {
  const block = Number(startBlock || 0);
  const knownPath = path.join(__dirname, '..', 'constants', 'deployedAddresses.ts');
  if (fs.existsSync(knownPath) && /^0x[0-9a-fA-F]{40}$/.test(address)) {
    let source = fs.readFileSync(knownPath, 'utf8');
    const reservaMatch = source.match(
      /export const DEPLOYED_TESTNET = \{[\s\S]*?reserva:\s*'([^']*)'/
    );
    const famaMatch = source.match(/export const DEPLOYED_TESTNET = \{[\s\S]*?fama:\s*'([^']*)'/);
    const reserva = reservaMatch ? reservaMatch[1] : '';
    const fama = /^0x[0-9a-fA-F]{40}$/.test(famaAddr || '')
      ? famaAddr
      : famaMatch
        ? famaMatch[1]
        : '';
    source = source.replace(
      /export const DEPLOYED_TESTNET = \{[\s\S]*?\} as const;/,
      `export const DEPLOYED_TESTNET = {
  chainId: 97,
  contract: '${address}',
  usdt: '${usdt}',
  reserva: '${reserva}',
  fama: '${fama}',
  startBlock: ${block || 0},
} as const;`
    );
    fs.writeFileSync(knownPath, source, 'utf8');
    console.log('Actualizado constants/deployedAddresses.ts');
  }
  const easPath = path.join(__dirname, '..', 'eas.json');
  if (fs.existsSync(easPath)) {
    const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
    for (const profile of ['development', 'preview']) {
      if (!eas.build?.[profile]?.env) continue;
      eas.build[profile].env.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET = address;
      if (block) eas.build[profile].env.EXPO_PUBLIC_CONTRACT_START_BLOCK = String(block);
    }
    fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n', 'utf8');
    console.log('Actualizado eas.json development/preview');
  }
}

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
  const chainId = Number(network.chainId);
  const isMainnet = chainId === BSC_MAINNET.chainId;
  const isTestnet = chainId === BSC_TESTNET.chainId;

  if (isMainnet) {
    throw new Error(
      'Mainnet usa scripts/deploy-mainnet-nuevo.cjs: crédito, fama, reserva y alta. No este script.'
    );
  }

  let usdt;
  let usdtFeed;
  if (isMainnet) {
    const envUsdt = (process.env.USDT_ADDRESS || '').toLowerCase();
    if (envUsdt && TESTNET_ONLY_USDT.has(envUsdt)) {
      console.warn('USDT de testnet ignorado: mainnet usa el USDT canónico de BSC.');
    }
    usdt = BSC_MAINNET.usdt;
    usdtFeed = BSC_MAINNET.usdtUsdFeed;
  } else {
    usdt = process.env.USDT_ADDRESS || BSC_TESTNET.usdt;
    usdtFeed = process.env.USDT_FEED || BSC_TESTNET.usdtUsdFeed;
  }

  const feeCollector = process.env.FEE_COLLECTOR || '';
  if (isMainnet && (!isHexAddress(feeCollector) || isZero(feeCollector))) {
    throw new Error('Mainnet exige FEE_COLLECTOR explícito (wallet de tesorería).');
  }
  const resolvedCollector =
    isHexAddress(feeCollector) && !isZero(feeCollector) ? feeCollector : deployer.address;
  const feeBp = Number(process.env.FEE_BP || '500');
  const { admins, confirms } = parseAdmins(deployer.address);
  if (isMainnet && admins.length < 1) {
    throw new Error('Mainnet exige al menos la billetera fundadora en ADMINS (la primera).');
  }
  if (isMainnet && admins.length === 1) {
    console.warn(
      'Mainnet con 1 fundadora. Las otras 2 se agregan desde la app (propuesta + 72 h). Al completar las 3, el contrato exige 2 firmas. Si una se pierde o la hackean, las otras 2 la echan.'
    );
  }
  if (isMainnet && admins.length >= 2 && confirms < 2) {
    throw new Error('Con 2 o más fundadoras, REQUIRED_CONFIRMATIONS debe ser >= 2.');
  }

  const usdtCode = await ethers.provider.getCode(usdt);
  const feedCode = await ethers.provider.getCode(usdtFeed);
  if (!usdtCode || usdtCode === '0x') {
    throw new Error(
      `USDT_ADDRESS no tiene bytecode en chain ${Number(network.chainId)}: ${usdt}. En BSC Testnet usa 0x337610d27c682e347c9cd60bd4b3b107c9d34ddd`
    );
  }
  if (!feedCode || feedCode === '0x') {
    throw new Error(`USDT_FEED no tiene bytecode: ${usdtFeed}`);
  }

  console.log('Network chainId:', Number(network.chainId));
  console.log('Deployer:', deployer.address);
  console.log('USDT:', usdt);
  console.log('USDT feed:', usdtFeed);
  console.log('Fee collector:', resolvedCollector);
  console.log('Admins:', admins);
  console.log('Confirmations:', confirms);

  const QuatriviumCredit = await getLinkedCreditFactory(ethers);
  const artifact = await hre.artifacts.readArtifact('QuatriviumCredit');
  const runtimeBytes = (artifact.deployedBytecode.length - 2) / 2;
  console.log('QuatriviumCredit runtime bytecode (bytes):', runtimeBytes);
  console.log('QuatriviumFamaLib:', QuatriviumCredit.famaLibAddress);
  if (chainId !== 31337 && runtimeBytes > 24576) {
    throw new Error(
      `QuatriviumCredit mide ${runtimeBytes} bytes y supera el límite EIP-170 (24576). No se puede desplegar en BSC hasta reducir el contrato.`
    );
  }

  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  const creditAddr = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const FamaCaja = await ethers.getContractFactory('QuatriviumFamaCaja');
  const fama = await FamaCaja.deploy(usdt, creditAddr);
  await fama.waitForDeployment();
  const famaAddr = await fama.getAddress();
  const contract = await QuatriviumCredit.deploy(
    usdt,
    usdtFeed,
    resolvedCollector,
    feeBp,
    admins,
    confirms,
    famaAddr
  );
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  if (address.toLowerCase() !== creditAddr.toLowerCase()) {
    throw new Error(`Credit previsto ${creditAddr} vs desplegado ${address}`);
  }
  console.log('Quatrivium Finance (QuatriviumCredit) deployed:', address);
  console.log('QuatriviumFamaCaja deployed:', famaAddr);

  if (isTestnet && process.env.SEED_POOL !== 'no') {
    const seedAmount = ethers.parseUnits(process.env.SEED_POOL || '500', 18);
    try {
      const token = await ethers.getContractAt('ERC20Mock', usdt);
      await (await token.mint(deployer.address, seedAmount)).wait();
      await (await token.approve(address, seedAmount)).wait();
      await (await contract.depositarLiquidez(usdt, seedAmount)).wait();
      console.log('Seeded pool:', ethers.formatUnits(seedAmount, 18));
    } catch (error) {
      console.warn(
        'Seed del pool omitido (el USDT de esta red no se puede mintear):',
        error.message || error
      );
    }
  }

  const envPath = path.join(__dirname, '..', '.env');
  upsertEnvKey(envPath, 'EXPO_PUBLIC_FEE_COLLECTOR', resolvedCollector);
  if (isTestnet) {
    const deployTx = contract.deploymentTransaction();
    const receipt = deployTx ? await deployTx.wait() : null;
    const startBlock = receipt?.blockNumber ? String(receipt.blockNumber) : '';
    if (startBlock) {
      upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_START_BLOCK', startBlock);
    }
    upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET', address);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_FAMA_ADDRESS_TESTNET', famaAddr);
    const workerPath = path.join(__dirname, '..', '.env.worker');
    if (fs.existsSync(workerPath)) {
      upsertEnvKey(workerPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET', address);
      upsertEnvKey(workerPath, 'EXPO_PUBLIC_FAMA_ADDRESS_TESTNET', famaAddr);
      if (startBlock) upsertEnvKey(workerPath, 'EXPO_PUBLIC_CONTRACT_START_BLOCK', startBlock);
    }
    writeTestnetKnownAddress(address, usdt, startBlock, famaAddr);
    console.log('Inyectado en .env: EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET=' + address);
  } else {
    upsertEnvKey(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET', address);
    upsertEnvKey(envPath, 'EXPO_PUBLIC_FAMA_ADDRESS_MAINNET', famaAddr);
    console.log('Inyectado en .env: EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET=' + address);
    const workerPath = path.join(__dirname, '..', '.env.worker');
    if (fs.existsSync(workerPath)) {
      upsertEnvKey(workerPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET', address);
      upsertEnvKey(workerPath, 'EXPO_PUBLIC_FAMA_ADDRESS_MAINNET', famaAddr);
      console.log('Inyectado en .env.worker: EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET=' + address);
    }
    console.log(
      'No se cambió EXPO_PUBLIC_CHAIN_ID ni USDT: el teléfono de desarrollo sigue en testnet.'
    );
    console.log(
      'El APK de tienda usa eas.json production (chain 56). Ponga el contrato como secreto EAS.'
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
