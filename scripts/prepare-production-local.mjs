/**
 * Prepara la configuración local soberana sin servidores Web2 y sin desplegar en mainnet.
 * No pone CHAIN_ID=42161 ni CONFIRM_MAINNET=yes en el .env de desarrollo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Wallet } from 'ethers';

const root = resolve(process.cwd());
const envPath = resolve(root, '.env');
const STALE_MAINNET = '0xa6aac9ce4923789a4095fbc0504db9a697f8a46d';
const STALE_TESTNET = '0x1E5118B378c7BCB3F3c5de7ec046B93E60f417a3';
const ZERO = '0x0000000000000000000000000000000000000000';
const TESTNET_CONTRACT = '0xD318f39834A5e798a11D2535c6c9D1E1270e6778';
const INVITE = 'https://quatriviumcredit.app';

function addressFromPrivateKey(raw) {
  const hex = String(raw || '')
    .trim()
    .replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return '';
  try {
    return new Wallet(`0x${hex}`).address;
  } catch {
    return '';
  }
}

function loadMap(filePath) {
  const map = {};
  if (!existsSync(filePath)) return map;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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

function upsert(filePath, key, value) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${key}=${value}\n`, 'utf8');
    return;
  }
  const original = readFileSync(filePath, 'utf8');
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
  writeFileSync(filePath, next.join('\n'), 'utf8');
}

const env = loadMap(envPath);
const done = [];

if (
  env.EXPO_PUBLIC_CHAIN_ID &&
  env.EXPO_PUBLIC_CHAIN_ID !== '421614' &&
  env.EXPO_PUBLIC_CHAIN_ID !== '97'
) {
  console.error(
    'Abortado: EXPO_PUBLIC_CHAIN_ID local no es de testnet (421614 / 97). No se toca el .env.'
  );
  process.exit(1);
}

const mainnet = (env.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET || '').toLowerCase();
if (!mainnet || mainnet === STALE_MAINNET) {
  upsert(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET', ZERO);
  done.push('Contrato mainnet viejo anulado (0x000… hasta el deploy nuevo en Arbitrum One)');
}

const testnetNow = (env.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET || '').toLowerCase();
if (testnetNow === STALE_TESTNET.toLowerCase() || testnetNow !== TESTNET_CONTRACT.toLowerCase()) {
  upsert(envPath, 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET', TESTNET_CONTRACT);
  done.push(
    testnetNow === STALE_TESTNET.toLowerCase()
      ? 'Contrato testnet retirado 0x1E5118 sustituido por el protocolo vivo 0xD318'
      : 'Contrato testnet actual escrito en .env'
  );
}

const fromKey = addressFromPrivateKey(env.PRIVATE_KEY);
if (!env.ADMINS) {
  if (!fromKey) {
    console.error(
      'Falta ADMINS o una PRIVATE_KEY válida para la fundadora. No se usa una dirección vieja.'
    );
    process.exit(1);
  }
  upsert(envPath, 'ADMINS', fromKey);
  done.push(
    'ADMINS = dirección de PRIVATE_KEY (fundadora 1). Cámbielo si la fundadora es otra wallet'
  );
}

if (!env.REQUIRED_CONFIRMATIONS) {
  upsert(envPath, 'REQUIRED_CONFIRMATIONS', '1');
  done.push('REQUIRED_CONFIRMATIONS=1 (con 3 fundadoras el contrato fuerza 2)');
}

if (!env.FEE_COLLECTOR && env.EXPO_PUBLIC_FEE_COLLECTOR) {
  upsert(envPath, 'FEE_COLLECTOR', env.EXPO_PUBLIC_FEE_COLLECTOR);
  done.push('FEE_COLLECTOR copiado de EXPO_PUBLIC_FEE_COLLECTOR. Cámbielo si la tesorería es otra');
}

if (!env.EXPO_PUBLIC_INVITE_WEB_BASE) {
  upsert(envPath, 'EXPO_PUBLIC_INVITE_WEB_BASE', INVITE);
  done.push('Dominio del portal web de invitaciones y descarga directa de APK');
}

const wc = env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || '';
if (wc && wc.length >= 16 && !/^your_/i.test(wc)) {
  const easPath = resolve(root, 'eas.json');
  const eas = JSON.parse(readFileSync(easPath, 'utf8'));
  let easChanged = false;
  for (const profile of Object.keys(eas.build || {})) {
    eas.build[profile].env = eas.build[profile].env || {};
    if (eas.build[profile].env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID !== wc) {
      eas.build[profile].env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID = wc;
      easChanged = true;
    }
  }
  if (easChanged) {
    writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n');
    done.push('WalletConnect escrito en eas.json (va en el APK, no es la clave de deploy)');
  }
}

console.log('production:prepare (100% soberano — sin worker ni servidores Web2)');
for (const line of done) console.log('- ' + line);
if (!done.length) console.log('- Nada que cambiar');
console.log('\nNo se desplegó mainnet. No se tocó EXPO_PUBLIC_CHAIN_ID local.');
