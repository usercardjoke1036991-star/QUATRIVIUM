const fs = require('fs');
const path = require('path');
const hre = require('hardhat');
const { ethers } = hre;
const { BSC_MAINNET, BSC_TESTNET, isHexAddress, isZero } = require('./bscNetworks.cjs');

const LIVE_TESTNET_CREDIT = '0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f';
const LIVE_TESTNET_USDT = '0x2d4AE5E6984D98777a24473F196326ff2604F5A6';

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

function writeReservaKnown(address) {
  const knownPath = path.join(__dirname, '..', 'constants', 'deployedAddresses.ts');
  if (!fs.existsSync(knownPath) || !isHexAddress(address)) return;
  let source = fs.readFileSync(knownPath, 'utf8');
  source = source.replace(/export const DEPLOYED_TESTNET = \{[\s\S]*?\} as const;/, (block) =>
    block.replace(/reserva:\s*'[^']*'/, `reserva: '${address}'`)
  );
  fs.writeFileSync(knownPath, source, 'utf8');
  console.log('Actualizado constants/deployedAddresses.ts reserva testnet');
}

function writeEasReserva(address) {
  const easPath = path.join(__dirname, '..', 'eas.json');
  if (!fs.existsSync(easPath)) return;
  const eas = JSON.parse(fs.readFileSync(easPath, 'utf8'));
  for (const profile of ['development', 'preview']) {
    if (!eas.build?.[profile]?.env) continue;
    eas.build[profile].env.EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET = address;
  }
  if (eas.build?.production?.env?.EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET) {
    delete eas.build.production.env.EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET;
  }
  fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n', 'utf8');
  console.log('Actualizado eas.json development/preview (no production)');
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId === BSC_MAINNET.chainId) {
    throw new Error(
      'Este script solo despliega Reserva en testnet. Mainnet exige CONFIRM_MAINNET=yes y deploy aparte.'
    );
  }
  if (chainId !== BSC_TESTNET.chainId && chainId !== 31337) {
    throw new Error(`Red no soportada para Reserva: chain ${chainId}`);
  }

  const creditAddr = process.env.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET || LIVE_TESTNET_CREDIT;
  const usdtAddr =
    process.env.EXPO_PUBLIC_USDT_ADDRESS || process.env.USDT_ADDRESS || LIVE_TESTNET_USDT;
  if (!isHexAddress(creditAddr) || isZero(creditAddr)) throw new Error('Credit testnet inválido');
  if (!isHexAddress(usdtAddr) || isZero(usdtAddr)) throw new Error('USDT testnet inválido');
  if (usdtAddr.toLowerCase() !== LIVE_TESTNET_USDT.toLowerCase()) {
    throw new Error(
      `USDT debe ser el de Demo live ${LIVE_TESTNET_USDT}, no el USDT canónico de testnet.`
    );
  }

  const creditCode = await ethers.provider.getCode(creditAddr);
  const usdtCode = await ethers.provider.getCode(usdtAddr);
  if (!creditCode || creditCode === '0x') throw new Error(`Credit sin bytecode: ${creditAddr}`);
  if (!usdtCode || usdtCode === '0x') throw new Error(`USDT sin bytecode: ${usdtAddr}`);

  const credit = await ethers.getContractAt(
    [
      'function fundador() view returns (address)',
      'function esMoroso(address) view returns (bool)',
      'function redGenealogica(address) view returns (address padre, bool bonoActivacionCobrado)',
    ],
    creditAddr
  );
  const fundador = await credit.fundador();
  if (!isHexAddress(fundador) || isZero(fundador)) throw new Error('Credit.fundador vacío');

  const bnb = await ethers.provider.getBalance(deployer.address);
  if (bnb < ethers.parseUnits('0.002', 18)) {
    throw new Error('BNB de testnet insuficiente para desplegar Reserva');
  }

  console.log('chainId', chainId);
  console.log('deployer', deployer.address);
  console.log('credit', creditAddr);
  console.log('usdt', usdtAddr);
  console.log('fundador', fundador);

  const Factory = await ethers.getContractFactory('QuatriviumReserva');
  const famaCaja =
    process.env.EXPO_PUBLIC_FAMA_ADDRESS_TESTNET ||
    process.env.FAMA_CAJA_ADDRESS ||
    ethers.ZeroAddress;
  const reserva = await Factory.deploy(usdtAddr, fundador, creditAddr, famaCaja);
  await reserva.waitForDeployment();
  const address = await reserva.getAddress();
  console.log('QuatriviumReserva', address);

  const tokenOnChain = await reserva.token();
  const creditOnChain = await reserva.credit();
  if (tokenOnChain.toLowerCase() !== usdtAddr.toLowerCase()) throw new Error('token() no coincide');
  if (creditOnChain.toLowerCase() !== creditAddr.toLowerCase())
    throw new Error('credit() no coincide');

  const seedRaw = process.env.SEED_RESERVA_BOTE;
  if (seedRaw !== 'no') {
    const seedAmount = ethers.parseUnits(seedRaw || '20', 18);
    const token = await ethers.getContractAt('ERC20Mock', usdtAddr);
    try {
      await (await token.mint(deployer.address, seedAmount)).wait();
    } catch (error) {
      console.warn('Mint USDT omitido:', error.shortMessage || error.message || error);
    }
    try {
      await (await token.approve(address, seedAmount)).wait();
      await (await reserva.aportarBote(seedAmount)).wait();
      console.log('Bote sembrado', ethers.formatUnits(seedAmount, 18));
    } catch (error) {
      console.warn('Seed del bote omitido:', error.shortMessage || error.message || error);
    }
  }

  const smoke = ethers.parseUnits(process.env.RESERVA_SMOKE_AMOUNT || '1', 18);
  if (process.env.RESERVA_SMOKE === 'yes') {
    try {
      const token = await ethers.getContractAt('ERC20Mock', usdtAddr);
      try {
        await (await token.mint(deployer.address, smoke)).wait();
      } catch {
        // ya hay saldo
      }
      await (await token.approve(address, smoke)).wait();
      await (await reserva.bloquear(smoke)).wait();
      const pos = await reserva.posiciones(deployer.address);
      if (!pos.activa) throw new Error('humo: posicion no activa');
      console.log('Humo bloquear ok, principal', ethers.formatUnits(pos.principal, 18));
    } catch (error) {
      console.warn('Humo bloquear omitido:', error.shortMessage || error.message || error);
    }
  } else {
    console.log(
      'Humo bloquear omitido (RESERVA_SMOKE!=yes) para no ocupar la posición del deployer'
    );
  }

  const envPath = path.join(__dirname, '..', '.env');
  upsertEnvKey(envPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET', address);
  const workerPath = path.join(__dirname, '..', '.env.worker');
  if (fs.existsSync(workerPath)) {
    upsertEnvKey(workerPath, 'EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET', address);
  }
  writeReservaKnown(address);
  writeEasReserva(address);
  console.log('LOCK', (await reserva.LOCK()).toString());
  console.log('bote', ethers.formatUnits(await reserva.bote(), 18));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
