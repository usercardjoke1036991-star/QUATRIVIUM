/**
 * Publica el worker en Fly.io (HTTPS 24/7). No imprime secretos.
 * Requiere: flyctl autenticado. TEXTBELT_API_KEY en .env.worker si hay SMS.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnEnv } from './spawnEnv.mjs';

const root = resolve(process.cwd());
const SAFE_PATH_WIN =
  'C:\\Windows\\System32;C:\\Windows;C:\\Program Files\\Docker\\Docker\\resources\\bin;C:\\Program Files\\Git\\cmd';

function flyctlBinary() {
  const candidates =
    process.platform === 'win32'
      ? [
          resolve(homedir(), '.fly', 'bin', 'flyctl.exe'),
          'C:\\Program Files\\flyctl\\flyctl.exe',
          'C:\\Program Files\\Fly\\flyctl.exe',
        ]
      : ['/usr/local/bin/flyctl', '/usr/bin/flyctl'];
  return candidates.find((item) => existsSync(item)) || '';
}

const flyctlBin = flyctlBinary();
if (!flyctlBin) {
  console.error('Instale Fly: iwr https://fly.io/install.ps1 -useb | iex');
  console.error('Luego: flyctl auth login');
  process.exit(1);
}

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

function fly(args, opts = {}) {
  const result = spawnSync(flyctlBin, args, {
    cwd: root,
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false,
    env: {
      ...spawnEnv(),
      PATH: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
      Path: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
    },
  });
  if (result.status !== 0 && !opts.allowFail) {
    process.exit(result.status || 1);
  }
  return result;
}

const flyctl = spawnSync(flyctlBin, ['version'], {
  encoding: 'utf8',
  shell: false,
  env: {
    ...spawnEnv(),
    PATH: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
    Path: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
  },
});
if (flyctl.status !== 0) {
  console.error('Instale Fly: iwr https://fly.io/install.ps1 -useb | iex');
  console.error('Luego: flyctl auth login');
  process.exit(1);
}

const who = spawnSync(flyctlBin, ['auth', 'whoami'], {
  encoding: 'utf8',
  shell: false,
  env: {
    ...spawnEnv(),
    PATH: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
    Path: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
  },
});
if (who.status !== 0) {
  console.error('Inicie sesión: flyctl auth login');
  process.exit(1);
}

const local = loadEnv(resolve(root, '.env'));
const worker = loadEnv(resolve(root, '.env.worker'));
const env = { ...local, ...worker };

function sameHexKey(a, b) {
  const left = String(a || '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase();
  const right = String(b || '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase();
  return Boolean(left) && left === right;
}

const attesterKey = String(env.ATTESTER_PRIVATE_KEY || '').trim();
if (!attesterKey) {
  console.error('Falta ATTESTER_PRIVATE_KEY en .env.worker. No se usa la clave de owner.');
  process.exit(1);
}
if (sameHexKey(attesterKey, env.PRIVATE_KEY)) {
  console.error('ATTESTER_PRIVATE_KEY debe ser distinta de PRIVATE_KEY.');
  process.exit(1);
}

const secrets = {
  NOTIFY_DATA_KEY: env.NOTIFY_DATA_KEY,
  TEXTBELT_API_KEY: env.TEXTBELT_API_KEY || env.TEXTBELT_KEY,
  TEXTBELT_SENDER: env.TEXTBELT_SENDER,
  RESEND_API_KEY: env.RESEND_API_KEY,
  EMAIL_FROM: env.EMAIL_FROM,
  TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM: env.TWILIO_FROM,
  TWILIO_VERIFY_SERVICE_SID: env.TWILIO_VERIFY_SERVICE_SID,
  ATTESTER_PRIVATE_KEY: attesterKey,
  EXPO_PUBLIC_BSC_RPC_URL_PRIMARY: env.EXPO_PUBLIC_BSC_RPC_URL_PRIMARY,
  BSC_TESTNET_RPC_URL: env.BSC_TESTNET_RPC_URL,
};

const pairs = Object.entries(secrets).filter(([, value]) => Boolean(value && String(value).trim()));
if (!secrets.NOTIFY_DATA_KEY || String(secrets.NOTIFY_DATA_KEY).length < 16) {
  console.error('Falta NOTIFY_DATA_KEY en .env.worker');
  process.exit(1);
}

const apps = spawnSync(flyctlBin, ['apps', 'list'], {
  encoding: 'utf8',
  shell: false,
  env: {
    ...spawnEnv(),
    PATH: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
    Path: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
  },
});
if (!String(apps.stdout || '').includes('quatrivium-notify')) {
  fly(['apps', 'create', 'quatrivium-notify'], { allowFail: true });
}

const volumes = spawnSync(flyctlBin, ['volumes', 'list', '-a', 'quatrivium-notify'], {
  encoding: 'utf8',
  shell: false,
  env: {
    ...spawnEnv(),
    PATH: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
    Path: process.platform === 'win32' ? SAFE_PATH_WIN : '/usr/bin:/bin:/usr/local/bin',
  },
});
if (!String(volumes.stdout || '').includes('notify_data')) {
  fly(
    [
      'volumes',
      'create',
      'notify_data',
      '--region',
      'iad',
      '--size',
      '1',
      '-a',
      'quatrivium-notify',
    ],
    {
      allowFail: true,
    }
  );
}

if (pairs.length) {
  fly([
    'secrets',
    'set',
    ...pairs.map(([key, value]) => `${key}=${value}`),
    '-a',
    'quatrivium-notify',
  ]);
}

fly(['deploy', '-a', 'quatrivium-notify', '--ha=false']);
console.log('Worker en https://quatrivium-notify.fly.dev/health');
console.log('Ponga esa URL en EXPO_PUBLIC_NOTIFY_API (.env, .env.worker y eas.json production).');
