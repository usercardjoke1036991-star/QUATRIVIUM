/** Preflight mainnet. No imprime secretos. No despliega. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { ARBITRUM_MAINNET, isHexAddress, isZero } = require('./arbitrumNetworks.cjs');

function loadEnv(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[line.slice(0, i).trim()] = value;
  }
  return map;
}

function addrFromKey(raw) {
  const hex = String(raw || '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return '';
  return new ethers.Wallet('0x' + hex).address;
}

async function codeOk(provider, address, label) {
  const code = await provider.getCode(address);
  const ok = Boolean(code && code !== '0x');
  console.log(`${ok ? 'OK' : 'FAIL'}  bytecode ${label} ${address} ${ok ? 'sí' : 'NO'}`);
  return ok;
}

async function main() {
  const root = path.join(__dirname, '..');
  const local = loadEnv(path.join(root, '.env'));
  const worker = loadEnv(path.join(root, '.env.worker'));
  const founderWanted = '0x5023bf46dB7458B9bb9152a7ffE64f195CD1a047';
  const attesterWanted = '0x140Fb8bD6611aC0c64cF254Dea1Ef4Caf15A821E';
  const staleMainnet = '0xa6aac9ce4923789a4095fbc0504db9a697f8a46d';

  const deployer = addrFromKey(local.PRIVATE_KEY);
  const attester = addrFromKey(worker.ATTESTER_PRIVATE_KEY);
  const admins = String(local.ADMINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => isHexAddress(item) && !isZero(item));
  const collector = String(local.FEE_COLLECTOR || '');
  const confirm = String(local.CONFIRM_MAINNET || '').trim();
  const chainId = String(local.EXPO_PUBLIC_CHAIN_ID || '');
  const mainnetAddr = String(local.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET || '').trim();

  console.log(
    'CONFIRM_MAINNET',
    confirm === 'yes' ? 'yes (NO desplegar aún si no hay ETH)' : '(vacío, bloqueado — correcto)'
  );
  console.log('APP chainId local', chainId || '(vacío)');
  console.log('Deployer', deployer || '(PRIVATE_KEY inválida)');
  console.log('Attester', attester || '(ATTESTER inválida)');
  console.log('ADMINS', admins.join(',') || '(vacío)');
  console.log('FEE_COLLECTOR', collector || '(vacío)');
  console.log('MAINNET_CONTRACT', mainnetAddr || '(vacío, correcto hasta el deploy)');

  const checks = [];
  checks.push(['deployer=fundadora', deployer.toLowerCase() === founderWanted.toLowerCase()]);
  checks.push(['attester=esperado', attester.toLowerCase() === attesterWanted.toLowerCase()]);
  checks.push([
    'attester≠deployer',
    Boolean(attester) && attester.toLowerCase() !== deployer.toLowerCase(),
  ]);
  checks.push([
    'ADMINS incluye fundadora',
    admins.some((a) => a.toLowerCase() === founderWanted.toLowerCase()),
  ]);
  checks.push(['FEE_COLLECTOR=fundadora', collector.toLowerCase() === founderWanted.toLowerCase()]);
  checks.push(['CONFIRM no es yes', confirm !== 'yes']);
  checks.push(['teléfono sigue testnet', chainId !== '42161']);
  checks.push([
    'mainnet addr no es el viejo',
    !mainnetAddr || mainnetAddr.toLowerCase() !== staleMainnet,
  ]);
  checks.push([
    '.env gitignored',
    fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('.env'),
  ]);

  const rpc = local.ARBITRUM_ONE_RPC_URL || ARBITRUM_MAINNET.rpc[0];
  const provider = new ethers.JsonRpcProvider(rpc, 42161);
  let bnb = 0n;
  let usdtBal = 0n;
  try {
    const net = await provider.getNetwork();
    checks.push(['RPC mainnet chain 42161', Number(net.chainId) === 42161]);
    await codeOk(provider, ARBITRUM_MAINNET.lusd, 'LUSD');
    await codeOk(provider, ARBITRUM_MAINNET.lusdUsdFeed, 'feed LUSD/USD');
    if (deployer) {
      bnb = await provider.getBalance(deployer);
      const usdt = new ethers.Contract(
        ARBITRUM_MAINNET.lusd,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );
      usdtBal = await usdt.balanceOf(deployer);
    }
  } catch (err) {
    checks.push(['RPC mainnet', false]);
    console.log('RPC_ERROR', err instanceof Error ? err.message : String(err));
  }

  const bnbFmt = ethers.formatEther(bnb);
  const usdtFmt = ethers.formatUnits(usdtBal, 18);
  console.log('ETH fundadora', bnbFmt);
  console.log('LUSD fundadora', usdtFmt);
  const enoughGas = bnb >= ethers.parseEther('0.03');
  checks.push(['ETH >= 0.03 para gas (recomendado 0.05+)', enoughGas]);

  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'OK' : 'FAIL'}  ${name}`);
    if (!ok) fail += 1;
  }
  console.log(enoughGas ? 'GAS_LISTO sí' : 'GAS_LISTO no — espera a que entre ETH y avísame');
  console.log(`PREFLIGHT ${checks.length - fail}/${checks.length}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
