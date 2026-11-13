/**
 * Lista lo que falta para mainnet soberano en Arbitrum One (chainId: 42161). No imprime secretos.
 * Uso: npm run production:check
 *      npm run production:check -- --strict   (sale 1 si mainnet no está completo)
 *      npm run production:check:ci            (solo el repo; sin variables de entorno locales)
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { isHexAddress, isZero } = createRequire(import.meta.url)('./arbitrumNetworks.cjs');

const root = resolve(process.cwd());
const strict = process.argv.includes('--strict');

const STALE_MAINNET = '0xa6aac9ce4923789a4095fbc0504db9a697f8a46d';
const LIVE_TESTNET = '0xD318f39834A5e798a11D2535c6c9D1E1270e6778';
const STALE_TESTNET = '0x1E5118B378c7BCB3F3c5de7ec046B93E60f417a3';
const LEGACY_TESTNET = '0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f';

function quotedAddress(src, name) {
  const body = src.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
  return (key) => body.match(new RegExp(`${key}: '(0x[0-9a-fA-F]{40})'`))?.[1] || '';
}

/** Actions no tiene .env. Verifica la configuración soberana del repositorio en Arbitrum One (42161). */
function runRepoCi() {
  const failures = [];
  const easPath = resolve(root, 'eas.json');
  let prod = {};
  try {
    prod = JSON.parse(readFileSync(easPath, 'utf8'))?.build?.production?.env || {};
  } catch {
    failures.push('eas.json no se pudo leer');
  }
  const deployedSrc = existsSync(resolve(root, 'constants/deployedAddresses.ts'))
    ? readFileSync(resolve(root, 'constants/deployedAddresses.ts'), 'utf8')
    : '';
  const mainnet = quotedAddress(deployedSrc, 'DEPLOYED_MAINNET');
  const testnet = quotedAddress(deployedSrc, 'DEPLOYED_TESTNET');
  const liveMain = mainnet('contract');
  const liveUsdt = mainnet('usdt');
  const liveDemo = testnet('contract');
  const demoUsdt = testnet('usdt');
  const lower = (value) => String(value || '').toLowerCase();
  const banned = [LIVE_TESTNET, STALE_TESTNET, LEGACY_TESTNET, STALE_MAINNET, liveDemo, demoUsdt]
    .map(lower)
    .filter(Boolean);

  if (String(prod.EXPO_PUBLIC_APP_ENV) !== 'production') {
    failures.push('eas.json production: EXPO_PUBLIC_APP_ENV debe ser production');
  }
  if (String(prod.EXPO_PUBLIC_CHAIN_ID) !== '42161') {
    failures.push('eas.json production: EXPO_PUBLIC_CHAIN_ID debe ser 42161 (Arbitrum One)');
  }
  if (/testnet|sepolia/i.test(String(prod.EXPO_PUBLIC_CHAIN_NAME || ''))) {
    failures.push('eas.json production no debe usar una red de testnet');
  }
  const credit = String(prod.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET || '');
  if (liveMain) {
    if (
      !isHexAddress(credit) ||
      banned.includes(lower(credit)) ||
      lower(credit) !== lower(liveMain)
    ) {
      failures.push('el crédito de production no es el de mainnet del repo');
    }
  } else if (credit && !isZero(credit)) {
    failures.push(
      'eas.json production tiene contrato mainnet distinto de 0x000… antes del despliegue en Arbitrum One'
    );
  }
  const demo = String(prod.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET || '');
  if (demo && liveDemo && (lower(demo) !== lower(liveDemo) || lower(demo) === lower(credit))) {
    failures.push(
      'la dirección de prueba del perfil production no es la Demo viva, o coincide con mainnet'
    );
  }
  const usdt = String(prod.EXPO_PUBLIC_USDT_ADDRESS || '');
  if (!usdt || lower(usdt) !== lower(liveUsdt) || (demoUsdt && lower(usdt) === lower(demoUsdt))) {
    failures.push('el LUSD de production no coincide con DEPLOYED_MAINNET.usdt');
  }
  const altaSrc = existsSync(resolve(root, 'constants/altaConfig.ts'))
    ? readFileSync(resolve(root, 'constants/altaConfig.ts'), 'utf8')
    : '';
  if (!/export const CREDIT_ALTA_USDT = 4;/.test(altaSrc)) {
    failures.push('constants/altaConfig.ts debe cobrar el alta de 4 LUSD');
  }
  const sameAddress = (left, right) => {
    if (!right) return !left || isZero(String(left));
    return isHexAddress(String(left || '')) && lower(left) === lower(right);
  };
  const watched = [
    ['EXPO_PUBLIC_FAMA_ADDRESS_MAINNET', mainnet('fama')],
    ['EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET', mainnet('reserva')],
    ['EXPO_PUBLIC_ALTA_ADDRESS_MAINNET', mainnet('alta')],
    ['EXPO_PUBLIC_FAMA_ADDRESS_TESTNET', testnet('fama')],
    ['EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET', testnet('reserva')],
    ['EXPO_PUBLIC_ALTA_ADDRESS_TESTNET', testnet('alta')],
  ];
  for (const [key, expected] of watched) {
    if (!sameAddress(prod[key], expected)) {
      failures.push(`${key} no coincide con deployedAddresses`);
    }
  }

  console.log('production:check:ci — solo el repo, 100% soberano (sin secretos ni worker)');
  if (failures.length) {
    for (const item of failures) console.error('FALTA  ' + item);
    process.exit(1);
  }
  console.log('OK  eas.json production: APP_ENV=production, chain 42161 (Arbitrum One)');
  console.log(
    'OK  LUSD (0x93b346b6BC2548dA6A1E7d98E9a421B42541425b) y contratos alineados con el repo'
  );
  console.log('OK  Modo 100% soberano (sin servidores Web2, SMS ni attester)');
  process.exit(0);
}

if (process.argv.includes('--ci')) runRepoCi();

function loadEnv(filePath) {
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

const env = loadEnv(resolve(root, '.env'));

const get = (key) => String(env[key] || '').trim();
const set = (key) => {
  const value = get(key);
  return Boolean(value) && !/^your_/i.test(value) && !value.includes('_here');
};
const https = (key) => /^https:\/\//i.test(get(key));

const admins = get('ADMINS')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => isHexAddress(item) && !isZero(item));

const checks = [
  {
    id: 'walletconnect',
    who: 'code',
    ok:
      set('EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID') &&
      get('EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID').length >= 16,
    need: 'Project ID de Reown (ya puede estar en .env local; también en eas.json)',
  },
  {
    id: 'contract',
    who: 'you',
    ok:
      isHexAddress(get('EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET')) &&
      !isZero(get('EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET')) &&
      get('EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET').toLowerCase() !== STALE_MAINNET,
    need:
      get('EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET').toLowerCase() === STALE_MAINNET
        ? 'El contrato mainnet guardado es de una versión vieja. Hay que desplegar QuatriviumCredit en Arbitrum One (CONFIRM_MAINNET=yes)'
        : 'Desplegar QuatriviumCredit en Arbitrum One mainnet (CONFIRM_MAINNET=yes && npm run deploy:arbitrum)',
  },
  {
    id: 'demo-contract',
    who: 'code',
    ok:
      !get('EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET') ||
      isZero(get('EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET')) ||
      (get('EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET').toLowerCase() !== STALE_TESTNET.toLowerCase() &&
        get('EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET').toLowerCase() !== LEGACY_TESTNET.toLowerCase()),
    need: 'EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET no debe apuntar al contrato retirado 0x1E5118 ni al legado 0xD2d2',
  },
  {
    id: 'admins',
    who: 'you',
    ok: admins.length >= 1,
    need: 'ADMINS=0xFundador (la primera es la fundadora). Las otras dos se listan ahora o se agregan después desde la app',
  },
  {
    id: 'admins-2of2',
    who: 'you',
    ok: admins.length >= 2,
    need: 'ADMINS con las dos claves. El quórum de mainnet es 2.',
  },
  {
    id: 'confirms',
    who: 'code',
    ok:
      Number(get('REQUIRED_CONFIRMATIONS') || '0') >= 1 &&
      (admins.length < 2 || Number(get('REQUIRED_CONFIRMATIONS') || '0') >= 2),
    need: 'REQUIRED_CONFIRMATIONS=1 con una fundadora. Con 3, el contrato exige 2 firmas aunque aquí ponga 1',
  },
  {
    id: 'treasury',
    who: 'you',
    ok: isHexAddress(get('FEE_COLLECTOR')) && !isZero(get('FEE_COLLECTOR')),
    need: 'FEE_COLLECTOR = wallet de tesorería (explícita, no se asume el deployer)',
  },
  {
    id: 'rpc',
    who: 'code',
    ok:
      https('ARBITRUM_ONE_RPC_URL') ||
      https('ARBITRUM_MAINNET_RPC_URL') ||
      https('EXPO_PUBLIC_ARBITRUM_RPC_URL_PRIMARY') ||
      https('EXPO_PUBLIC_ARBITRUM_RPC_URL'),
    need: 'RPC HTTPS para Arbitrum One en ARBITRUM_ONE_RPC_URL (o usa el pool público por defecto)',
  },
  {
    id: 'invite',
    who: 'code',
    ok: https('EXPO_PUBLIC_INVITE_WEB_BASE'),
    need: 'Dominio del portal web de invitaciones y descarga directa de APK en EXPO_PUBLIC_INVITE_WEB_BASE',
  },
  {
    id: 'eas-store',
    who: 'code',
    ok: (() => {
      const easPath = resolve(root, 'eas.json');
      if (!existsSync(easPath)) return false;
      try {
        const prod = JSON.parse(readFileSync(easPath, 'utf8'))?.build?.production?.env || {};
        return (
          String(prod.EXPO_PUBLIC_APP_ENV) === 'production' &&
          String(prod.EXPO_PUBLIC_CHAIN_ID) === '42161' &&
          !prod.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET
        );
      } catch {
        return false;
      }
    })(),
    need: 'eas.json production: APP_ENV=production, chain 42161 (Arbitrum One), sin contrato de testnet',
  },
];

const deployDay = {
  id: 'confirm',
  ok: get('CONFIRM_MAINNET') === 'yes',
  need: 'CONFIRM_MAINNET=yes solo el minuto del deploy, luego quitarlo',
};

const missing = checks.filter((item) => !item.ok);
const youDo = checks.filter((item) => item.who === 'you' && !item.ok);
const chainId = Number(env.EXPO_PUBLIC_CHAIN_ID || '421614');
const appEnv = env.EXPO_PUBLIC_APP_ENV || 'development';

console.log('Quatrivium Sovereign — verificación de producción en Arbitrum One (42161)');
console.log(`App local ahora: APP_ENV=${appEnv || '(vacío)'}  chainId=${chainId}`);
console.log('');
for (const item of checks) {
  const tag = item.who === 'you' ? 'TÚ  ' : 'repo';
  console.log(
    `${item.ok ? 'OK   ' : 'FALTA'}  ${tag}  ${item.id.padEnd(14)}  ${item.ok ? '' : item.need}`
  );
}
console.log(
  `${deployDay.ok ? 'OK   ' : 'LUEGO'}  TÚ    ${deployDay.id.padEnd(14)}  ${deployDay.ok ? '' : deployDay.need}`
);
console.log('');
if (chainId !== 42161) {
  console.log('La app del teléfono sigue en testnet (Arbitrum Sepolia). Eso es correcto.');
  console.log('El APK de producción usa el perfil EAS production (chain 42161 — Arbitrum One).');
}
console.log(`Config: ${checks.length - missing.length}/${checks.length} listos.`);

if (youDo.length) {
  console.log('\nLo que solo puede hacer usted:');
  for (const item of youDo) console.log('  - ' + item.need);
  console.log(
    '  - ETH de gas en Arbitrum One en la wallet deployer, luego CONFIRM_MAINNET=yes y npm run deploy:arbitrum'
  );
  console.log('  - Depositar LUSD real al pool desde la app en modo Real');
  console.log('  - Compilar el APK soberano cuando se autorice el lanzamiento');
}

if (strict && (missing.length || !deployDay.ok)) {
  process.exit(1);
}
if (!missing.length) {
  console.log('\nConfig lista. Día del deploy: CONFIRM_MAINNET=yes && npm run deploy:arbitrum');
}
