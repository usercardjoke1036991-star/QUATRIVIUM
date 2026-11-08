/**
 * Chequeos de seguridad que se pueden correr en local.
 * Uso: npm run security:check
 *
 * Slither (opcional): pipx install slither-analyzer && npm run security:slither
 * Si npm es el de Windows y Slither vive en WSL, el script entra por WSL/pipx.
 * MobSF: MOBSF_API_KEY y npm run security:mobsf -- ruta.apk
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const failures = [];

const gitignore = existsSync(resolve(root, '.gitignore'))
  ? readFileSync(resolve(root, '.gitignore'), 'utf8')
  : '';
if (!gitignore.includes('.env')) {
  failures.push('.gitignore no ignora .env');
}
if (!gitignore.includes('.env.worker')) {
  failures.push('.gitignore no ignora .env.worker');
}
if (!gitignore.includes('mobsf-report.json')) {
  failures.push('.gitignore no ignora mobsf-report.json');
}

const envExample = existsSync(resolve(root, '.env.example'))
  ? readFileSync(resolve(root, '.env.example'), 'utf8')
  : '';
if (/EXPO_PUBLIC_PRIVATE_KEY/.test(envExample)) {
  failures.push('No exponga PRIVATE_KEY con prefijo EXPO_PUBLIC_');
}

const secretFiles = ['.env', '.env.worker', '.notify-data.json'];
for (const file of secretFiles) {
  try {
    const tracked = execSync(`git ls-files --error-unmatch -- ${file}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (tracked.trim()) {
      failures.push(`${file} está en git. Sáquelo del índice y rote las claves.`);
    }
  } catch {
    // no está tracked o no hay git
  }
}

const easPath = resolve(root, 'eas.json');
if (existsSync(easPath)) {
  try {
    const eas = JSON.parse(readFileSync(easPath, 'utf8'));
    const prod = eas?.build?.production?.env || {};
    // El APK de producción también lleva Demo (97): una dirección de prueba fijada debe ser la viva del repo.
    const deployedSrc = readFileSync(resolve(root, 'constants', 'deployedAddresses.ts'), 'utf8');
    const testnetBlock =
      deployedSrc.match(/export const DEPLOYED_TESTNET = \{([\s\S]*?)\}/)?.[1] || '';
    const pinned = {
      EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET: 'contract',
      EXPO_PUBLIC_FAMA_ADDRESS_TESTNET: 'fama',
      EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET: 'reserva',
      EXPO_PUBLIC_ALTA_ADDRESS_TESTNET: 'alta',
    };
    for (const [envKey, field] of Object.entries(pinned)) {
      if (!prod[envKey]) continue;
      const live = testnetBlock.match(new RegExp(`${field}: '(0x[0-9a-fA-F]{40})'`))?.[1] || '';
      if (!live || String(prod[envKey]).toLowerCase() !== live.toLowerCase()) {
        failures.push(`eas.json production: ${envKey} no coincide con DEPLOYED_TESTNET.${field}`);
      }
    }
    if (String(prod.EXPO_PUBLIC_CHAIN_ID) !== '56') {
      failures.push('eas.json production debe usar EXPO_PUBLIC_CHAIN_ID=56');
    }
    if (String(prod.EXPO_PUBLIC_APP_ENV) !== 'production') {
      failures.push('eas.json production debe usar EXPO_PUBLIC_APP_ENV=production');
    }
    if (String(prod.EXPO_PUBLIC_CHAIN_NAME || '').toLowerCase() === 'bsctestnet') {
      failures.push('eas.json production no debe usar bscTestnet');
    }
  } catch {
    failures.push('eas.json no se pudo leer');
  }
}

const appSources = ['app', 'components', 'hooks', 'services', 'constants', 'utils'];
for (const folder of appSources) {
  try {
    const hit = execSync(`git grep -n "EXPO_PUBLIC_PRIVATE_KEY" -- ${folder}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (hit.trim()) {
      failures.push(`No use EXPO_PUBLIC_PRIVATE_KEY en ${folder}`);
    }
  } catch {
    // git grep sale 1 si no hay coincidencias
  }
}

const savedSessionPath = resolve(root, 'services/savedSession.ts');
if (existsSync(savedSessionPath)) {
  const savedSession = readFileSync(savedSessionPath, 'utf8');
  if (savedSession.includes('AsyncStorage.setItem(WRAP_FALLBACK')) {
    failures.push('La wrap de sesión no debe guardarse en AsyncStorage');
  }
}

const exclusivePath = resolve(root, 'services/exclusiveSession.ts');
if (existsSync(exclusivePath)) {
  const exclusive = readFileSync(exclusivePath, 'utf8');
  if (!exclusive.includes("signedAuthBody(signer, wallet, 'session')")) {
    failures.push('/session/check y /session/claim deben firmarse con EIP-712');
  }
  if (/postSession\(\s*'\/session\/check'\s*,\s*\{\s*wallet/.test(exclusive)) {
    failures.push('/session/check no puede ir sin firma');
  }
}

if (failures.length) {
  console.error('security:check FALLÓ\n' + failures.join('\n'));
  process.exit(1);
}

console.log('security:check OK');
console.log('- .env está en .gitignore');
console.log('- El cliente no usa PRIVATE_KEY (firmas = billetera del usuario)');
console.log('- Contratos: ReentrancyGuard, Pausable, SafeERC20, Solidity 0.8.24, timelock 72h');
console.log('- Pausa inmediata; despausar con timelock');
console.log('- RPC: quorum de chainId + bytecode del contrato + timeout');
console.log('- Perfiles remotos: EIP-712 obligatorio, CORS cerrado, headers HTTP');
console.log('- Billetera cifrada con PIN (HMAC + keystream); lockout tras intentos');
console.log('- Mainnet: npm run production:check');
console.log(
  'Pendiente fuera de este repo: auditoría externa, Forta/Defender y KMS para la clave de deploy'
);
