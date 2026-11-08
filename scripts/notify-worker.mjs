/**
 * Avisos Quatrivium Finance: Telegram y WhatsApp Cloud API.
 * Uso: npm run notify          (demo / testnet, lee .env y .env.worker si existe)
 *      npm run notify:prod     (real / mainnet, exige .env.worker)
 *
 * 1. OTP SMS: TEXTBELT_API_KEY (pago). Twilio y WhatsApp Cloud son respaldo.
 * 2. (Opcional) Telegram: TELEGRAM_BOT_TOKEN. WhatsApp: WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID.
 * 3. El usuario vincula su número o abre el bot desde la app.
 */
// TLS lo termina Render/Caddy. El proceso solo escucha HTTP en el puerto privado.
import { createServer } from 'node:http'; // NOSONAR javascript:S5332 -- edge TLS, not a public cleartext API
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  chmodSync,
  unlinkSync,
  accessSync,
  constants as fsConstants,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  verifyTypedData,
  keccak256,
  toUtf8Bytes,
  AbiCoder,
  getBytes,
  Signature,
  ZeroAddress,
} from 'ethers';
import dotenv from 'dotenv';
import { requireDistinctAttesterKeys, cosignPacked, verifyCosign } from './attest2of2.mjs';
import { generateAdminTotpSecret, verifyAdminTotp, adminTotpUrl } from './adminTotp.mjs';

dotenv.config();
const workerEnv = resolve(process.cwd(), '.env.worker');
const wantProd = process.argv.includes('--prod') || process.env.NOTIFY_PROFILE === 'prod';
if (wantProd && !existsSync(workerEnv)) {
  console.error('Falta .env.worker. Copie .env.worker.example o corra npm run production:prepare');
  process.exit(1);
}
if (existsSync(workerEnv)) {
  dotenv.config({ path: workerEnv, override: wantProd });
}

const require = createRequire(import.meta.url);
const { BSC_MAINNET, BSC_TESTNET, isHexAddress, isZero } = require('./bscNetworks.cjs');
const { sanitizeTelegramBot } = require('./telegramBotName.cjs');
const { sendTextbeltSms, isTextbeltConfigured } = createRequire(import.meta.url)(
  './textbeltSms.cjs'
);

const PORT = Number(process.env.PORT || process.env.NOTIFY_PORT || 8787);
const probeWritableDir = (dir) => {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, fsConstants.W_OK);
    const probe = resolve(dir, `.w-${process.pid}`);
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
};
const resolveDataFile = () => {
  const requested = process.env.NOTIFY_DATA_FILE
    ? resolve(process.env.NOTIFY_DATA_FILE)
    : resolve(process.cwd(), '.notify-data.json');
  if (probeWritableDir(dirname(requested))) return requested;
  const fallback = resolve(process.cwd(), 'data', '.notify-data.json');
  if (fallback !== requested && probeWritableDir(dirname(fallback))) {
    console.error(`NOTIFY_DATA_FILE no escribible (${requested}); persistencia en ${fallback}`);
    return fallback;
  }
  console.error(`No se puede escribir el almacén en ${requested}`);
  process.exit(1);
  return requested;
};
const DATA_FILE = resolveDataFile();
const CHAIN_ID = Number(process.env.EXPO_PUBLIC_CHAIN_ID || 97);
const isMainnet = CHAIN_ID === BSC_MAINNET.chainId;
const CONTRACT = (() => {
  const chosen = isMainnet
    ? process.env.EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET
    : process.env.EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET;
  return isHexAddress(chosen) && !isZero(chosen) ? chosen : '';
})();
const RESERVA = (() => {
  const chosen = isMainnet
    ? process.env.EXPO_PUBLIC_RESERVA_ADDRESS_MAINNET
    : process.env.EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET;
  return isHexAddress(chosen) && !isZero(chosen) ? chosen : '';
})();
const RPC = isMainnet
  ? process.env.BSC_MAINNET_RPC_URL ||
    process.env.EXPO_PUBLIC_BSC_RPC_URL_PRIMARY ||
    BSC_MAINNET.rpc[0]
  : process.env.EXPO_PUBLIC_BSC_RPC_URL_PRIMARY ||
    process.env.BSC_TESTNET_RPC_URL ||
    BSC_TESTNET.rpc[0];
const expectedChainId = isMainnet ? BSC_MAINNET.chainId : BSC_TESTNET.chainId;
const expectedChainName = isMainnet ? BSC_MAINNET.chainName : BSC_TESTNET.chainName;
const publicRpc = (url) => {
  const value = String(url || '');
  if (!/^https:\/\//i.test(value)) return false;
  // Ankr público responde 401 sin API key y deja el provider reintentando para siempre.
  if (/rpc\.ankr\.com/i.test(value) && !/rpc\.ankr\.com\/[^/]+\/[A-Za-z0-9]/i.test(value))
    return false;
  return true;
};
const RPC_CANDIDATES = [
  ...new Set(
    [
      RPC,
      process.env.BSC_MAINNET_RPC_URL,
      process.env.BSC_TESTNET_RPC_URL,
      process.env.EXPO_PUBLIC_BSC_RPC_URL_PRIMARY,
      process.env.EXPO_PUBLIC_BSC_RPC_URL_FALLBACK_1,
      process.env.EXPO_PUBLIC_BSC_RPC_URL_FALLBACK_2,
      ...(isMainnet ? BSC_MAINNET.rpc : BSC_TESTNET.rpc),
    ].filter(publicRpc)
  ),
];
let rpcCursor = 0;
const makeProvider = (url) =>
  new JsonRpcProvider(
    url,
    { chainId: expectedChainId, name: expectedChainName },
    { staticNetwork: true, batchMaxCount: 1 }
  );
const probeRpc = async (url) => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(6000),
    });
    const body = await response.json();
    return Number.parseInt(String(body.result || '0'), 16) === expectedChainId;
  } catch {
    return false;
  }
};
const nextRpc = () => {
  if (RPC_CANDIDATES.length < 2) return RPC_CANDIDATES[0] || RPC;
  rpcCursor = (rpcCursor + 1) % RPC_CANDIDATES.length;
  return RPC_CANDIDATES[rpcCursor];
};
const rpcRateLimited = (error) =>
  /rate limit|-32005|limit exceeded|could not coalesce/i.test(
    String(error?.message || error || '')
  );
const rpcUnhealthy = (error) =>
  /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|502|503|504|missing response|failed to detect network|server error|network/i.test(
    String(error?.message || error || '')
  );
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_PUBLIC = sanitizeTelegramBot(
  process.env.TELEGRAM_BOT || process.env.EXPO_PUBLIC_TELEGRAM_BOT || ''
);
let cachedTelegramBot = TELEGRAM_PUBLIC;
const publicTelegramBot = async () => {
  if (cachedTelegramBot) return cachedTelegramBot;
  if (!TELEGRAM_TOKEN) return '';
  try {
    const data = await (
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`, {
        signal: AbortSignal.timeout(8000),
      })
    ).json();
    const username = sanitizeTelegramBot(data?.result?.username);
    if (username) cachedTelegramBot = username;
    return username;
  } catch {
    return '';
  }
};
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TEXTBELT_KEY = process.env.TEXTBELT_API_KEY || process.env.TEXTBELT_KEY || '';
const TEXTBELT_SENDER = process.env.TEXTBELT_SENDER || 'Quatrivium';
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || '';
let twilioVerifySid = process.env.TWILIO_VERIFY_SERVICE_SID || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const ATTESTER_EXPLICIT = process.env.ATTESTER_PRIVATE_KEY || '';
const ATTESTER_COSIGN_KEY = process.env.ATTESTER_COSIGN_KEY || '';
const REQUIRE_ATTESTER_2OF2 = process.env.ATTESTER_2OF2 === '1';
const DEPLOY_KEY = process.env.PRIVATE_KEY || '';
const sameKey = (a, b) => {
  const n = (value) =>
    String(value || '')
      .replace(/^0x/i, '')
      .toLowerCase();
  return Boolean(a) && Boolean(b) && n(a) === n(b) && n(a).length >= 64;
};
if (isMainnet && !ATTESTER_EXPLICIT) {
  console.error('Mainnet: ATTESTER_PRIVATE_KEY es obligatorio.');
  process.exit(1);
}
if (isMainnet && sameKey(ATTESTER_EXPLICIT, DEPLOY_KEY)) {
  console.error('Mainnet: ATTESTER_PRIVATE_KEY debe ser distinta de PRIVATE_KEY.');
  process.exit(1);
}
// Solo localhost puede firmar con PRIVATE_KEY. En Render/0.0.0.0 nunca: el owner no es attester.
const bindEarly = process.env.NOTIFY_BIND || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const publicAttesterHost =
  Boolean(process.env.RENDER) || (bindEarly !== '127.0.0.1' && bindEarly !== '::1');
const ATTESTER_KEY = ATTESTER_EXPLICIT || (!isMainnet && !publicAttesterHost ? DEPLOY_KEY : '');
let attesterReady = false;
try {
  if (ATTESTER_KEY) {
    new Wallet(ATTESTER_KEY);
    attesterReady = true;
  }
} catch {
  console.error(
    'ATTESTER_PRIVATE_KEY no es una clave Ethereum. No pulse Generate; pegue la clave de la billetera attester.'
  );
  if (isMainnet) process.exit(1);
}
const START_BLOCK = Number(process.env.EXPO_PUBLIC_CONTRACT_START_BLOCK || 0);
const ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';
const CORS_ORIGINS = (process.env.NOTIFY_CORS_ORIGIN || '*')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const DATA_KEY_RAW = process.env.NOTIFY_DATA_KEY || '';
const hashPhone = (phone) => keccak256(toUtf8Bytes(`quatrivium.phone.v1:${DATA_KEY_RAW}:${phone}`));
const hashEmail = (email) => keccak256(toUtf8Bytes(`quatrivium.email.v1:${DATA_KEY_RAW}:${email}`));
const BIND = process.env.NOTIFY_BIND || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const TRUST_PROXY = process.env.NOTIFY_TRUST_PROXY === '1' || Boolean(process.env.RENDER);
const allowDemoIdentity =
  !isMainnet && (process.env.NOTIFY_DEMO_IDENTITY === '1' || !publicAttesterHost);
const hasTextbelt = isTextbeltConfigured(TEXTBELT_KEY);
const hasSms =
  hasTextbelt ||
  Boolean(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM) ||
  Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID);
const hasEmail = Boolean(RESEND_KEY && EMAIL_FROM);
const SUMSUB_TOKEN = process.env.SUMSUB_APP_TOKEN || '';
const SUMSUB_SECRET = process.env.SUMSUB_SECRET || '';
const SUMSUB_LEVEL = process.env.SUMSUB_LEVEL_NAME || '';
const hasKycProvider = Boolean(SUMSUB_TOKEN && SUMSUB_SECRET && SUMSUB_LEVEL);
if (DATA_KEY_RAW.length < 16) {
  console.error(
    'NOTIFY_DATA_KEY de al menos 16 caracteres es obligatorio (cifra teléfonos y Telegram en disco).'
  );
  process.exit(1);
}
if (isMainnet && CORS_ORIGINS.includes('*')) {
  console.error('NOTIFY_CORS_ORIGIN no puede ser * en mainnet.');
  process.exit(1);
}
if (isMainnet && !CONTRACT) {
  console.error('Mainnet: falta EXPO_PUBLIC_CONTRACT_ADDRESS_MAINNET.');
  process.exit(1);
}
if (isMainnet && !ATTESTER_KEY) {
  console.error('Mainnet: falta ATTESTER_PRIVATE_KEY distinta del owner.');
  process.exit(1);
}
if ((isMainnet || REQUIRE_ATTESTER_2OF2) && ATTESTER_COSIGN_KEY) {
  const two = requireDistinctAttesterKeys(ATTESTER_KEY, ATTESTER_COSIGN_KEY);
  if (two) {
    console.error(
      'Attester 2-de-2: ATTESTER_COSIGN_KEY debe existir y ser distinta de ATTESTER_PRIVATE_KEY.'
    );
    process.exit(1);
  }
}
if (REQUIRE_ATTESTER_2OF2 && !ATTESTER_COSIGN_KEY) {
  console.error('ATTESTER_2OF2=1 exige ATTESTER_COSIGN_KEY distinta.');
  process.exit(1);
}
if (isMainnet && !hasSms) {
  console.error('Mainnet: configure TEXTBELT_API_KEY, Twilio o WhatsApp Cloud API para el OTP.');
  process.exit(1);
}
if (isMainnet && !hasEmail) {
  console.error('Mainnet: configure RESEND_API_KEY y EMAIL_FROM para el correo.');
  process.exit(1);
}
if (isMainnet && BIND !== '127.0.0.1' && BIND !== '::1' && !TRUST_PROXY) {
  console.error(
    'Mainnet: NOTIFY_BIND debe ser 127.0.0.1 detrás de Nginx/Caddy, o NOTIFY_TRUST_PROXY=1.'
  );
  process.exit(1);
}
const AUTH_DOMAIN = {
  name: 'Quatrivium Credit',
  version: '2',
  chainId: CHAIN_ID,
  verifyingContract:
    CONTRACT && /^0x[0-9a-fA-F]{40}$/.test(CONTRACT) && !/0x0{40}/i.test(CONTRACT)
      ? CONTRACT
      : '0x0000000000000000000000000000000000000001',
};
const AUTH_TYPES = {
  Auth: [
    { name: 'wallet', type: 'address' },
    { name: 'purpose', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'deviceHash', type: 'bytes32' },
    { name: 'phone', type: 'string' },
  ],
};

const ABI = [
  'function usuarios(address) view returns (uint256 nivelActual, uint256 montoActivo, uint256 vencimiento, bool enMora, address monedaActivo, uint256 tasaAplicadaBP)',
  'function planPago(address) view returns (uint128 pagado, uint64 venceCuota, uint8 totales, uint8 pagadas, bool enPlazo)',
  'function obtenerProgresoUsuario(address usuario) view returns (uint256 nivelActual, uint256 solicitudesCompletadas, uint256 ultimoPrestamoTimestamp)',
  'function walletOfPhone(bytes32) view returns (address)',
  'function walletOfDevice(bytes32) view returns (address)',
  'event AfiliadoRegistrado(address indexed usuario, address indexed padre)',
  'event BonoActivacionPagado(address indexed padre, address indexed referido, uint256 monto, address indexed token)',
  'event ComisionGeneracional(address indexed beneficiario, address indexed deudor, uint8 generacion, uint256 monto, address indexed token)',
  'event AdminActionExecuted(uint256 indexed id, bytes4 selector)',
  'event Paused(address account)',
  'event Unpaused(address account)',
  'function paused() view returns (bool)',
];

const RESERVA_ABI = [
  'function paused() view returns (bool)',
  'function syncPauseFromCredit()',
  'function posiciones(address) view returns (uint256 principal, uint256 desde, bool activa, bool enRed)',
  'function extraComisionDe(address beneficiario, uint256 montoBase) view returns (uint256 extra, uint256 founderCut)',
  'function boostUsado(bytes32) view returns (bool)',
  'function boostIdOf(address beneficiario, uint256 montoBase, bytes32 salt) view returns (bytes32)',
  'function boostPausado() view returns (bool)',
  'function pagarBoostComision(address beneficiario, uint256 montoBase, bytes32 salt)',
  'event Bloqueado(address indexed usuario, uint256 monto, uint256 desbloqueo)',
  'event Desbloqueado(address indexed usuario, uint256 principal, uint256 rendimiento, uint256 corteFundador)',
  'event BoostComision(address indexed beneficiario, uint256 montoBase, uint256 extra, uint256 corteFundador)',
  'event BoteAportado(address indexed de, uint256 monto)',
  'event Paused(address account)',
  'event Unpaused(address account)',
];

let requestOrigin = '';

const dataKey = () => {
  if (!DATA_KEY_RAW) return null;
  return createHash('sha256').update(DATA_KEY_RAW).digest();
};

const corsOrigin = () => {
  if (CORS_ORIGINS.includes('*')) return '*';
  if (requestOrigin && CORS_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return 'null';
};

const originAllowed = () => {
  if (CORS_ORIGINS.includes('*')) return true;
  if (!requestOrigin) return true;
  return CORS_ORIGINS.includes(requestOrigin);
};

const clientIp = (req) => {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    if (forwarded) return forwarded.slice(0, 64);
  }
  return req.socket.remoteAddress || 'ip';
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Resource-Policy': 'same-site',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

const json = (res, status, body) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': corsOrigin(),
    Vary: 'Origin',
    ...SECURITY_HEADERS,
  };
  if (isMainnet || process.env.RENDER) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
};

const emptyStore = () => ({
  profiles: {},
  telegramByWallet: {},
  walletByChat: {},
  lastBlock: 0,
  watchedContract: '',
  startBlock: 0,
  reminded: {},
  usedAuth: {},
  pendingBinds: {},
  telegramOffers: {},
  otps: {},
  emailOtps: {},
  phoneClaims: {},
  emailClaims: {},
  usernameClaims: {},
  exclusiveSessions: {},
  rateHits: {},
  recoveryWraps: {},
  recoverOtps: {},
  recoverQuota: {},
  reservaGuard: { creditPaused: null, reservaPaused: null },
  adminTotp: {},
});

const STORE_KEYS = Object.keys(emptyStore());

/** El wrap de la billetera no se guarda en el worker. Se borra si un disco viejo aún lo tenía. */
const sanitizeLoadedStore = (parsed) => {
  const next = emptyStore();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return next;
  for (const key of STORE_KEYS) {
    if (key === 'recoveryWraps') continue;
    if (Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key] != null) {
      next[key] = parsed[key];
    }
  }
  next.recoveryWraps = {};
  return next;
};

const writeAtomic = (file, buffer) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, buffer);
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows / volúmenes sin chmod.
  }
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, buffer);
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
};

const loadStore = () => {
  if (!existsSync(DATA_FILE)) return emptyStore();
  const raw = readFileSync(DATA_FILE);
  const key = dataKey();
  const encrypted = raw.length > 31 && raw.subarray(0, 3).toString() === 'ENC';
  if (encrypted) {
    if (!key) {
      console.error('NOTIFY_DATA_KEY es obligatorio para leer el almacén cifrado.');
      process.exit(1);
    }
    try {
      const iv = raw.subarray(3, 15);
      const tag = raw.subarray(15, 31);
      const data = raw.subarray(31);
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      return sanitizeLoadedStore({ ...emptyStore(), ...JSON.parse(plain) });
    } catch {
      console.error(
        'No se pudo descifrar .notify-data.json. Revise NOTIFY_DATA_KEY; no se sobrescribe el archivo.'
      );
      process.exit(1);
    }
  }
  try {
    const parsed = sanitizeLoadedStore({ ...emptyStore(), ...JSON.parse(raw.toString('utf8')) });
    if (key) {
      try {
        saveStore(parsed);
      } catch {
        console.error('No se pudo cifrar el almacén al migrar de texto plano.');
      }
    }
    return parsed;
  } catch {
    console.error(
      'El almacén de avisos existe pero no es JSON válido. Arranque abortado para no borrar datos.'
    );
    process.exit(1);
  }
};

const saveStore = (next) => {
  const clean = sanitizeLoadedStore(next);
  const payload = JSON.stringify(clean);
  const key = dataKey();
  if (!key) {
    writeAtomic(DATA_FILE, Buffer.from(payload, 'utf8'));
    return;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const enc = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  writeAtomic(DATA_FILE, Buffer.concat([Buffer.from('ENC'), iv, cipher.getAuthTag(), enc]));
};

let persistChain = Promise.resolve();
const persist = () => {
  const snapshot = JSON.stringify(store);
  persistChain = persistChain
    .catch(() => {})
    .then(() => {
      saveStore(JSON.parse(snapshot));
    });
  return persistChain.catch((error) => {
    console.error('No se pudo guardar el almacén de avisos.');
    throw error;
  });
};

let store = loadStore();
if (CONTRACT) {
  const prevContract = String(store.watchedContract || '').toLowerCase();
  const nextContract = CONTRACT.toLowerCase();
  const prevStart = Number(store.startBlock || 0);
  const contractChanged = Boolean(prevContract) && prevContract !== nextContract;
  const startChanged = prevStart > 0 && START_BLOCK > 0 && prevStart !== START_BLOCK;
  if (contractChanged || startChanged) {
    store.lastBlock = START_BLOCK > 0 ? START_BLOCK : 0;
    console.log('Avisos chain: contrato o bloque de inicio nuevo, se reinicia el barrido');
  }
  store.watchedContract = CONTRACT;
  store.startBlock = START_BLOCK;
  if (!store.lastBlock && START_BLOCK > 0) store.lastBlock = START_BLOCK;
  try {
    saveStore(store);
  } catch {
    // El watcher sigue; persistirá en el siguiente evento.
  }
}
if (!isMainnet) {
  store.rateHits = store.rateHits || {};
  for (const key of Object.keys(store.rateHits)) {
    if (key.startsWith('email:') || key.startsWith('email-addr:')) delete store.rateHits[key];
  }
}

const pruneRates = () => {
  const now = Date.now();
  store.rateHits = store.rateHits || {};
  for (const key of Object.keys(store.rateHits)) {
    const next = (store.rateHits[key] || []).filter((item) => now - item < 15 * 60 * 1000);
    if (next.length) store.rateHits[key] = next;
    else delete store.rateHits[key];
  }
  const leftover = Object.keys(store.rateHits);
  if (leftover.length > 8000) {
    leftover.slice(0, leftover.length - 4000).forEach((key) => delete store.rateHits[key]);
  }
};

const rateLimit = (key, max = 20, windowMs = 60_000) => {
  const now = Date.now();
  store.rateHits = store.rateHits || {};
  if (Object.keys(store.rateHits).length > 2000) pruneRates();
  const next = (store.rateHits[key] || []).filter((item) => now - item < windowMs);
  if (next.length >= max) {
    store.rateHits[key] = next;
    return false;
  }
  next.push(now);
  store.rateHits[key] = next;
  return true;
};

const RECOVER_DAY_ATTEMPTS = 3;
const RECOVER_SEND_WAIT_MS = 60 * 1000;

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

const recoverQuotaFor = (emailHash, now = Date.now()) => {
  store.recoverQuota = store.recoverQuota || {};
  const day = utcDay(now);
  const keys = Object.keys(store.recoverQuota);
  if (keys.length > 4000) {
    for (const key of keys) {
      if (store.recoverQuota[key]?.day !== day) delete store.recoverQuota[key];
    }
  }
  const row = store.recoverQuota[emailHash];
  if (!row || row.day !== day) {
    store.recoverQuota[emailHash] = { day, attempts: 0, sends: 0, lastSent: 0 };
  }
  return store.recoverQuota[emailHash];
};

const refundRate = (key) => {
  const hits = store.rateHits?.[key];
  if (!hits?.length) return;
  hits.pop();
  if (hits.length) store.rateHits[key] = hits;
  else delete store.rateHits[key];
};

const stripUnsafe = (value, max = 64) =>
  String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[<>`"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const parseAllowedEmail = (value) => {
  const email = String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 80);
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return { email: '', canonical: '' };
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return { email, canonical: `${local.split('+')[0].replace(/\./g, '')}@gmail.com` };
  }
  if (
    domain === 'proton.me' ||
    domain === 'protonmail.com' ||
    domain === 'protonmail.ch' ||
    domain === 'pm.me'
  ) {
    return { email, canonical: `${local.split('+')[0]}@proton.me` };
  }
  return { email: '', canonical: '' };
};

const normalizeUsername = (value) => {
  const username = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 100);
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(username)) return '';
  const reserved = new Set([
    'admin',
    'owner',
    'fundador',
    'founder',
    'support',
    'ayuda',
    'quatrivium',
    'official',
    'oficial',
    'root',
    'null',
    'undefined',
  ]);
  return reserved.has(username) ? '' : username;
};

const AUTH_PURPOSES = [
  'vincular-avisos',
  'perfil',
  'otp',
  'email',
  'username',
  'demo-identity',
  'session',
  'identity',
  'autofund',
  'admin-totp',
];

const requireAuth = (body, allowed) => {
  const wallet = String(body.wallet || '').toLowerCase();
  const purpose = String(body.purpose || '');
  const timestamp = Number(body.timestamp);
  const signature = String(body.signature || '');
  const deviceHash = String(body.deviceHash || '').toLowerCase();
  const phone = String(body.phone || '');
  if (!wallet.startsWith('0x') || wallet.length !== 42) throw new Error('wallet');
  if (
    purpose !== 'vincular-avisos' &&
    purpose !== 'perfil' &&
    purpose !== 'otp' &&
    purpose !== 'email' &&
    purpose !== 'username' &&
    purpose !== 'demo-identity' &&
    purpose !== 'session' &&
    purpose !== 'identity' &&
    purpose !== 'autofund' &&
    purpose !== 'admin-totp'
  ) {
    throw new Error('purpose');
  }
  if (!AUTH_PURPOSES.includes(purpose)) throw new Error('purpose');
  if (Array.isArray(allowed) && allowed.length && !allowed.includes(purpose)) {
    throw new Error('purpose');
  }
  if (
    !Number.isFinite(timestamp) ||
    timestamp > Date.now() + 60_000 ||
    Date.now() - timestamp > 5 * 60 * 1000
  ) {
    throw new Error('timestamp');
  }
  if (!signature.startsWith('0x') || signature.length < 130) throw new Error('signature');
  if (!/^0x[0-9a-f]{64}$/.test(deviceHash)) throw new Error('device');
  if (purpose === 'otp') {
    if (!normalizeE164(phone)) throw new Error('phone');
  } else if (purpose === 'email') {
    if (phone && !parseAllowedEmail(phone).email) throw new Error('email');
  } else if (purpose === 'username') {
    if (!normalizeUsername(phone)) throw new Error('username');
  } else if (phone) {
    throw new Error('phone');
  }
  const signedPhone =
    purpose === 'otp'
      ? normalizeE164(phone)
      : purpose === 'email'
        ? parseAllowedEmail(phone).email
        : purpose === 'username'
          ? normalizeUsername(phone)
          : '';
  const replayKey = createHash('sha256')
    .update(`${wallet}:${purpose}:${timestamp}:${deviceHash}:${signature}`)
    .digest('hex');
  if (store.usedAuth[replayKey]) throw new Error('replay');
  const authValue = {
    wallet: getAddress(wallet),
    purpose,
    timestamp,
    deviceHash,
    phone: signedPhone,
  };
  const authDomains = [AUTH_DOMAIN];
  // Hasta mainnet, la app en Cuenta Real firma chain 56 + contrato vacío. El worker Demo debe aceptar ese sello para correo/OTP.
  if (!isMainnet) {
    authDomains.push({
      name: AUTH_DOMAIN.name,
      version: AUTH_DOMAIN.version,
      chainId: BSC_MAINNET.chainId,
      verifyingContract: '0x0000000000000000000000000000000000000001',
    });
  }
  let recovered = '';
  for (const domain of authDomains) {
    try {
      const next = verifyTypedData(domain, AUTH_TYPES, authValue, signature).toLowerCase();
      if (next === wallet) {
        recovered = next;
        break;
      }
    } catch {
      // Probar el siguiente dominio.
    }
  }
  if (recovered !== wallet) throw new Error('signature');
  store.usedAuth[replayKey] = timestamp;
  void persist();
  const cutoff = Date.now() - 15 * 60 * 1000;
  const usedKeys = Object.keys(store.usedAuth);
  for (const key of usedKeys) {
    if (Number(store.usedAuth[key]) < cutoff) delete store.usedAuth[key];
  }
  if (usedKeys.length > 20_000) {
    for (const key of usedKeys.slice(0, usedKeys.length - 10_000)) delete store.usedAuth[key];
  }
  const parsedEmail = purpose === 'email' ? parseAllowedEmail(phone) : { email: '', canonical: '' };
  return {
    wallet,
    deviceHash,
    phone: purpose === 'otp' ? normalizeE164(phone) : '',
    email: parsedEmail.email,
    emailCanonical: parsedEmail.canonical,
    username: purpose === 'username' ? normalizeUsername(phone) : '',
  };
};

const alertAdmin = async (text) => {
  if (!ADMIN_CHAT) return;
  await sendTelegram(ADMIN_CHAT, text);
};

const sanitizePublicPhoto = (value) => {
  const uri = String(value || '').replace(/\s/g, '');
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(uri)) return '';
  if (uri.length > 60_000) return '';
  return uri;
};

const readBody = (req, limit = 32_768) =>
  new Promise((resolveBody, rejectBody) => {
    const timeout = setTimeout(() => {
      rejectBody(new Error('timeout'));
      req.destroy();
    }, 8_000);
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        clearTimeout(timeout);
        rejectBody(new Error('payload'));
        req.destroy();
      }
    });
    req.on('end', () => {
      clearTimeout(timeout);
      try {
        resolveBody(JSON.parse(raw || '{}'));
      } catch {
        rejectBody(new Error('json'));
      }
    });
    req.on('error', () => {
      clearTimeout(timeout);
      rejectBody(new Error('json'));
    });
  });

const sendTelegram = async (chatId, text) => {
  if (!TELEGRAM_TOKEN || !chatId) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const sendWhatsApp = async (phone, text) => {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !phone) return false;
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(phone).replace(/\D/g, ''),
        type: 'text',
        text: { body: text },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const twilioBasic = () => Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

const oneLine = (value) =>
  String(value || '')
    .replace(/[\r\n\u2028\u2029]/g, ' ')
    .slice(0, 180);

const assertTwilioUrl = (url) => {
  const parsed = new URL(String(url));
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') throw new Error('twilio');
  if (host !== 'api.twilio.com' && host !== 'verify.twilio.com') throw new Error('twilio');
  return parsed.toString();
};

const twilioJson = async (url, init = {}) => {
  try {
    const response = await fetch(assertTwilioUrl(url), {
      ...init,
      headers: {
        Authorization: `Basic ${twilioBasic()}`,
        ...(init.headers || {}),
      },
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) {
      const detail = oneLine(body.message || body.code || response.status);
      console.error('Twilio HTTP', response.status, detail);
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    console.error('Twilio red', error?.cause?.code || error?.name || 'fail');
    return { ok: false, status: 0, body: {} };
  }
};

const twilioForm = (url, params) =>
  twilioJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

const sendTextbelt = async (phone, text) => {
  if (!hasTextbelt || !phone) return false;
  const e164 = normalizeE164(phone);
  if (!e164) {
    console.error('Textbelt', 'phone');
    return false;
  }
  const result = await sendTextbeltSms(e164, text, { key: TEXTBELT_KEY, sender: TEXTBELT_SENDER });
  if (!result.ok) {
    console.error('Textbelt', result.error || 'fail');
    return false;
  }
  return true;
};

const sendSms = async (phone, text) => {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !phone) return false;
  const result = await twilioForm(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    { To: phone, From: TWILIO_FROM, Body: text }
  );
  return result.ok;
};

const ensureTwilioVerifyService = async () => {
  if (twilioVerifySid) return twilioVerifySid;
  if (!TWILIO_SID || !TWILIO_TOKEN) return '';
  const listed = await twilioJson('https://verify.twilio.com/v2/Services?PageSize=50');
  const services = Array.isArray(listed.body.services) ? listed.body.services : [];
  const existing = services.find((row) => /quatrivium/i.test(String(row.friendly_name || '')));
  if (existing?.sid) {
    twilioVerifySid = existing.sid;
    return twilioVerifySid;
  }
  const created = await twilioForm('https://verify.twilio.com/v2/Services', {
    FriendlyName: 'Quatrivium Finance',
    CodeLength: '6',
  });
  if (created.ok && created.body.sid) {
    twilioVerifySid = created.body.sid;
    return twilioVerifySid;
  }
  return '';
};

const startTwilioVerify = async (phone, customCode) => {
  const sid = await ensureTwilioVerifyService();
  if (!sid || !phone) return { ok: false, custom: false };
  const params = { To: phone, Channel: 'sms' };
  if (customCode) params.CustomCode = customCode;
  let result = await twilioForm(
    `https://verify.twilio.com/v2/Services/${sid}/Verifications`,
    params
  );
  if (result.ok) return { ok: true, custom: Boolean(customCode) };
  if (customCode) {
    result = await twilioForm(`https://verify.twilio.com/v2/Services/${sid}/Verifications`, {
      To: phone,
      Channel: 'sms',
    });
    if (result.ok) return { ok: true, custom: false };
  }
  return { ok: false, custom: false };
};

const checkTwilioVerify = async (phone, code) => {
  const sid = twilioVerifySid || (await ensureTwilioVerifyService());
  if (!sid || !phone || !/^\d{6}$/.test(code)) return false;
  const result = await twilioForm(
    `https://verify.twilio.com/v2/Services/${sid}/VerificationCheck`,
    {
      To: phone,
      Code: code,
    }
  );
  return result.ok && String(result.body.status || '') === 'approved';
};

const deliverOtp = async (phone, code) => {
  const text = `Quatrivium Finance: su código de autenticación es ${code}. Caduca en 10 minutos. No lo comparta.`;
  if (await sendTextbelt(phone, text)) return { channel: 'sms', via: 'textbelt' };
  if (await sendSms(phone, text)) return { channel: 'sms', via: 'body' };
  const verified = await startTwilioVerify(phone, code);
  if (verified.ok)
    return { channel: 'sms', via: verified.custom ? 'verify-custom' : 'twilio-verify' };
  if (await sendWhatsApp(phone, text)) return { channel: 'whatsapp', via: 'body' };
  return { channel: '', via: '' };
};

const sendEmail = async (to, subject, text) => {
  if (!RESEND_KEY || !EMAIL_FROM || !to) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text }),
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = String(body.message || body.name || '').slice(0, 180);
      } catch {
        detail = '';
      }
      console.error('Resend HTTP', response.status, oneLine(detail));
    }
    return response.ok;
  } catch (error) {
    console.error('Resend red', error?.cause?.code || error?.name || 'fail');
    return false;
  }
};

const deliverEmailOtp = async (email, code) => {
  const text = `Quatrivium Finance: su código es ${code}. Caduca en 10 minutos. No lo comparta.`;
  if (await sendEmail(email, 'Quatrivium Finance: código de verificación', text)) return 'email';
  return '';
};

const normalizeE164 = (value) => {
  const trimmed = String(value || '').replace(/[^\d+]/g, '');
  if (!trimmed) return '';
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  return /^\+[1-9]\d{7,14}$/.test(withPlus) ? withPlus : '';
};

const hashOtp = (code, phoneHash, wallet) =>
  createHash('sha256').update(`${DATA_KEY_RAW}:${code}:${phoneHash}:${wallet}`).digest('hex');

const hashRecoverOtp = (code, emailHash) =>
  createHash('sha256').update(`${DATA_KEY_RAW}:pwrecover:${code}:${emailHash}`).digest('hex');

const sixDigitCode = () => {
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, '0');
  }
};

const wrapOk = (value) => /^0x[0-9a-f]{64}$/.test(String(value || ''));

let identityProvider = RPC_CANDIDATES[0] || RPC ? makeProvider(RPC_CANDIDATES[0] || RPC) : null;
const setIdentityProvider = (url) => {
  identityProvider = url ? makeProvider(url) : null;
};

const takenByOther = (owner, wallet) => {
  if (!owner || owner === ZeroAddress) return false;
  return String(owner).toLowerCase() !== String(wallet).toLowerCase();
};

const hashBound = (value) => {
  const hash = String(value || '');
  return Boolean(hash) && !/^0x0+$/i.test(hash);
};

const IDENTITY_CLAIM_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const readBoundIdentity = async (wallet) => {
  if (!CONTRACT || !identityProvider) return { phoneHash: '', deviceHash: '' };
  const contract = new Contract(
    CONTRACT,
    [
      'function phoneHashOf(address) view returns (bytes32)',
      'function deviceHashOf(address) view returns (bytes32)',
    ],
    identityProvider
  );
  const [phoneHash, deviceHash] = await Promise.all([
    contract.phoneHashOf(wallet),
    contract.deviceHashOf(wallet),
  ]);
  return { phoneHash: String(phoneHash || ''), deviceHash: String(deviceHash || '') };
};

const assertIdentityAvailable = async (phoneHash, deviceHash, wallet) => {
  if (!CONTRACT || !identityProvider) return;
  const contract = new Contract(
    CONTRACT,
    [
      'function walletOfPhone(bytes32) view returns (address)',
      'function walletOfDevice(bytes32) view returns (address)',
    ],
    identityProvider
  );
  const [phoneOwner, deviceOwner] = await Promise.all([
    contract.walletOfPhone(phoneHash),
    contract.walletOfDevice(deviceHash),
  ]);
  if (takenByOther(phoneOwner, wallet)) {
    const error = new Error('phone taken');
    error.status = 409;
    throw error;
  }
  if (takenByOther(deviceOwner, wallet)) {
    const error = new Error('device taken');
    error.status = 409;
    throw error;
  }
};

const sumsubHeaders = (method, pathWithQuery, body = '') => {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', SUMSUB_SECRET)
    .update(ts + method.toUpperCase() + pathWithQuery + body)
    .digest('hex');
  return {
    Accept: 'application/json',
    'X-App-Token': SUMSUB_TOKEN,
    'X-App-Access-Ts': ts,
    'X-App-Access-Sig': sig,
  };
};

const isSumsubHttps = (value) => {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'sumsub.com' || host.endsWith('.sumsub.com');
  } catch {
    return false;
  }
};

const sumsubProviderLink = async (wallet) => {
  if (!hasKycProvider) {
    const error = new Error('not configured');
    error.status = 503;
    throw error;
  }
  const userId = encodeURIComponent(getAddress(wallet));
  const level = encodeURIComponent(SUMSUB_LEVEL);
  const pathWithQuery = `/resources/sdkIntegrations/levels/${level}/websdkLink?externalUserId=${userId}&ttlInSecs=1800`;
  const response = await fetch(`https://api.sumsub.com${pathWithQuery}`, {
    method: 'GET',
    headers: sumsubHeaders('GET', pathWithQuery),
  });
  const payload = await response.json().catch(() => ({}));
  const url = String(payload.url || payload.websdkLink || '');
  if (!response.ok || !isSumsubHttps(url)) {
    const error = new Error('provider');
    error.status = 503;
    throw error;
  }
  return url;
};

const attestIdentity = async (wallet, phoneHash, deviceHash) => {
  if (!ATTESTER_KEY || !CONTRACT || !/^0x[0-9a-fA-F]{40}$/.test(CONTRACT)) {
    throw new Error('attester');
  }
  const deadline = Math.floor(Date.now() / 1000) + 30 * 60;
  let nonce = 0n;
  if (identityProvider) {
    const credit = new Contract(
      CONTRACT,
      ['function attestNonce(address) view returns (uint256)'],
      identityProvider
    );
    nonce = await credit.attestNonce(getAddress(wallet));
  }
  const packed = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'address'],
      [getAddress(wallet), phoneHash, deviceHash, deadline, nonce, CHAIN_ID, getAddress(CONTRACT)]
    )
  );
  if (REQUIRE_ATTESTER_2OF2 || ATTESTER_COSIGN_KEY) {
    const two = requireDistinctAttesterKeys(ATTESTER_KEY, ATTESTER_COSIGN_KEY);
    if (two) throw new Error('attester-2of2');
    const cosign = await cosignPacked(ATTESTER_COSIGN_KEY, packed);
    if (!verifyCosign(packed, cosign.signature, cosign.address)) {
      throw new Error('attester-2of2');
    }
  }
  const signer = new Wallet(ATTESTER_KEY);
  const signature = await signer.signMessage(getBytes(packed));
  const parsed = Signature.from(signature);
  return {
    phoneHash,
    deviceHash,
    deadline,
    nonce: nonce.toString(),
    v: parsed.v,
    r: parsed.r,
    s: parsed.s,
  };
};

const notifyWallet = async (wallet, kind, text) => {
  const profile = store.profiles[wallet.toLowerCase()];
  const chatId = store.telegramByWallet[wallet.toLowerCase()];
  const pushChannels = kind === 'debt' || profile?.prefs?.[kind] === true;
  if (!pushChannels || !chatId) return;
  await sendTelegram(chatId, text);
};

const telegramLinked = (wallet) =>
  Boolean(store.telegramByWallet[String(wallet || '').toLowerCase()]);

const bindTelegram = (wallet, chatId) => {
  const key = String(wallet).toLowerCase();
  const nextChat = String(chatId);
  const prevChat = String(store.telegramByWallet[key] || '');
  const same = Boolean(prevChat) && prevChat === nextChat;
  if (prevChat && !same && store.walletByChat[prevChat] === key) {
    delete store.walletByChat[prevChat];
  }
  const previousOwner = store.walletByChat[nextChat];
  if (previousOwner && previousOwner !== key) {
    delete store.telegramByWallet[previousOwner];
  }
  store.telegramByWallet[key] = nextChat;
  store.walletByChat[nextChat] = key;
  saveStore(store);
  return { same, replaced: Boolean(prevChat) && !same };
};

const telegramLabel = (message) => {
  const from = message?.from || {};
  const chat = message?.chat || {};
  const username = String(from.username || chat.username || '')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 32);
  const name = String(from.first_name || chat.first_name || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 40);
  if (username) return `@${username}`;
  return name || 'Telegram';
};

/** El /start no vincula. Deja la oferta para que la cartera la confirme en la app. */
const holdTelegramOffer = (payload, chatId, message) => {
  const code = String(payload || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9]{8,16}$/.test(code)) return null;
  const chatKey = String(chatId || '');
  if (!/^\d{1,20}$/.test(chatKey)) return null;
  store.pendingBinds = store.pendingBinds || {};
  const pending = store.pendingBinds[code];
  if (!pending) return null;
  delete store.pendingBinds[code];
  if (Number(pending.exp) < Date.now()) {
    saveStore(store);
    return null;
  }
  const wallet = String(pending.wallet || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    saveStore(store);
    return null;
  }
  store.telegramOffers = store.telegramOffers || {};
  store.telegramOffers[wallet] = {
    chatId: chatKey,
    label: telegramLabel(message),
    exp: Date.now() + 10 * 60 * 1000,
  };
  saveStore(store);
  return store.telegramOffers[wallet];
};

const liveTelegramOffer = (wallet) => {
  const key = String(wallet || '').toLowerCase();
  store.telegramOffers = store.telegramOffers || {};
  const offer = store.telegramOffers[key];
  if (!offer) return null;
  if (Number(offer.exp) < Date.now() || !/^\d{1,20}$/.test(String(offer.chatId || ''))) {
    delete store.telegramOffers[key];
    return null;
  }
  return offer;
};

const pollTelegram = async () => {
  if (!TELEGRAM_TOKEN) return;
  let offset = 0;
  let telegramAlive = true;
  const stopTelegram = () => {
    telegramAlive = false;
  };
  process.once('SIGTERM', stopTelegram);
  process.once('SIGINT', stopTelegram);
  while (true) {
    if (!telegramAlive) break;
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?timeout=25&offset=${offset}`;
      const data = await (await fetch(url)).json();
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        const message = update.message;
        const text = String(message?.text || '');
        const chatId = message?.chat?.id;
        if (!chatId || !text.startsWith('/start')) continue;
        const payload = text.replace('/start', '').trim();
        const offer = holdTelegramOffer(payload, chatId, message);
        if (offer) {
          await sendTelegram(
            chatId,
            'Quatrivium Finance: vuelva a la app y confirme que este chat es el suyo. Hasta entonces los avisos no se vinculan.'
          );
        } else {
          await sendTelegram(
            chatId,
            'Abra el vínculo desde Quatrivium Finance para vincular esta cuenta. No envíe una dirección a mano.'
          );
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 4000));
    }
    telegramAlive = Boolean(TELEGRAM_TOKEN) && telegramAlive;
  }
};

const DAY = 86400;

const installmentWindows = (loanStart, loanDue, nextDue, installments) => {
  const startTs = Number(loanStart) || 0;
  const dueTs = Number(loanDue) || 0;
  const due = Number(nextDue) || dueTs;
  const n = Math.max(1, Number(installments) || 1);
  if (due <= 0) return null;
  const full = Math.max(0, dueTs - startTs);
  const duration =
    n <= 1
      ? full > 0
        ? full
        : Math.max(1, due - startTs)
      : full > 0
        ? Math.max(1, Math.floor(full / n))
        : Math.max(1, due - startTs);
  const start = n <= 1 ? startTs || due - duration : Math.max(startTs || 0, due - duration);
  const span = Math.max(1, due - start);
  const cutoffLead =
    span >= 3 * DAY ? DAY : Math.min(6 * 3600, Math.max(3600, Math.floor(span / 4)));
  return {
    mid: start + Math.floor(span / 2),
    due,
    cutoffAt: due - cutoffLead,
  };
};

const scanDebtReminders = async (contract) => {
  const wallets = new Set([...Object.keys(store.profiles), ...Object.keys(store.telegramByWallet)]);
  const now = Math.floor(Date.now() / 1000);
  let changed = false;
  for (const wallet of wallets) {
    try {
      const loan = await contract.usuarios(wallet);
      if (!Number(loan.montoActivo) && !loan.enMora) continue;
      const due = Number(loan.vencimiento);
      let nextDue = due;
      let totales = 1;
      try {
        const plan = await contract.planPago(wallet);
        nextDue = Number(plan.venceCuota) || due;
        totales = Number(plan.totales) || 1;
      } catch {
        // contrato anterior
      }
      let loanStart = 0;
      try {
        const progress = await contract.obtenerProgresoUsuario(wallet);
        loanStart = Number(progress.ultimoPrestamoTimestamp || progress[2] || 0);
      } catch {
        // ignore
      }
      const windows = installmentWindows(loanStart, due, nextDue, totales);
      if (!windows) continue;
      const midKey = `${wallet}:${windows.due}:mid`;
      const cutKey = `${wallet}:${windows.due}:cutoff`;
      if (
        windows.mid < windows.cutoffAt - 3600 &&
        now >= windows.mid &&
        now < windows.cutoffAt &&
        !store.reminded[midKey]
      ) {
        await notifyWallet(
          wallet,
          'debt',
          'Quatrivium Finance: va a la mitad del plazo. Puede pagar ahora y no dejarlo para el corte.'
        );
        store.reminded[midKey] = true;
        changed = true;
      }
      if (now >= windows.cutoffAt && now <= windows.due + 3600 && !store.reminded[cutKey]) {
        await notifyWallet(
          wallet,
          'debt',
          'Quatrivium Finance: el pago vence pronto. Regularice antes del corte para no entrar en mora.'
        );
        store.reminded[cutKey] = true;
        changed = true;
      }
    } catch {
      // ignore wallet
    }
  }
  if (changed) saveStore(store);
};

const pagarBoostReserva = async (event) => {
  if (!RESERVA || !ATTESTER_KEY || !identityProvider) return;
  const beneficiario = String(event.args?.beneficiario || '');
  const monto = event.args?.monto ?? 0n;
  if (!/^0x[0-9a-fA-F]{40}$/.test(beneficiario) || !monto) return;
  try {
    const reservaContract = new Contract(RESERVA, RESERVA_ABI, identityProvider);
    if (await reservaContract.boostPausado()) return;
    const [extra] = await reservaContract.extraComisionDe(beneficiario, monto);
    if (!extra) return;
    const salt = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint256'],
        [event.transactionHash, event.index]
      )
    );
    const id = await reservaContract.boostIdOf(beneficiario, monto, salt);
    if (await reservaContract.boostUsado(id)) return;
    const signer = new Wallet(ATTESTER_KEY, identityProvider);
    const tx = await reservaContract.connect(signer).pagarBoostComision(beneficiario, monto, salt);
    await tx.wait(1);
    await notifyWallet(
      beneficiario,
      'commission',
      'Quatrivium Finance: extra de Reserva sobre su comisión.'
    );
  } catch (error) {
    console.warn('reserva boost comisión:', error.message || error);
  }
};

const guardReservaPause = async (creditContract, reservaContract) => {
  if (!reservaContract || !creditContract) return;
  try {
    const [creditPaused, reservaPaused] = await Promise.all([
      creditContract.paused(),
      reservaContract.paused(),
    ]);
    store.reservaGuard = {
      creditPaused: Boolean(creditPaused),
      reservaPaused: Boolean(reservaPaused),
      at: Date.now(),
    };
    if (!creditPaused || reservaPaused) return;
    await alertAdmin(
      'Quatrivium Finance ALERTA: el crédito está pausado y Reserva aún aceptaba locks. Se llama syncPauseFromCredit (el principal se puede desbloquear).'
    );
    if (!ATTESTER_KEY || !identityProvider) return;
    const signer = new Wallet(ATTESTER_KEY, identityProvider);
    const tx = await reservaContract.connect(signer).syncPauseFromCredit();
    await tx.wait(1);
    store.reservaGuard.reservaPaused = true;
    store.reservaGuard.synced = true;
    await alertAdmin(
      'Quatrivium Finance: Reserva pausada en nuevos locks. El desbloqueo de principal sigue abierto.'
    );
  } catch (error) {
    console.warn('reserva guardian:', error.message || error);
  }
};

const watchChain = async () => {
  if (!CONTRACT || !RPC) {
    console.log('Avisos: falta contrato o RPC. El servidor de perfiles sigue activo.');
    return;
  }
  let rpcUrl = RPC_CANDIDATES[0] || RPC;
  for (const candidate of RPC_CANDIDATES) {
    if (await probeRpc(candidate)) {
      rpcUrl = candidate;
      break;
    }
  }
  let provider = makeProvider(rpcUrl);
  setIdentityProvider(rpcUrl);
  let contract = new Contract(CONTRACT, ABI, provider);
  let reserva = RESERVA ? new Contract(RESERVA, RESERVA_ABI, provider) : null;
  try {
    if (!store.lastBlock) {
      const latest = await provider.getBlockNumber();
      store.lastBlock = START_BLOCK > 0 ? START_BLOCK : latest;
      saveStore(store);
    }
  } catch (error) {
    console.warn('Avisos chain: no se pudo leer el bloque inicial', error?.message || error);
  }

  let lastDebtCheck = 0;
  let logWindow = 200;
  let rateLimitStreak = 0;
  for (;;) {
    let scannedTo = Number(store.lastBlock || 0);
    try {
      const latest = await provider.getBlockNumber();
      const lag = store.lastBlock > 0 ? latest - store.lastBlock : 0;
      if (lag > 4000) {
        store.lastBlock = Math.max(0, latest - 400);
        saveStore(store);
        console.warn(`Avisos chain: ${lag} bloques atrás, se sigue desde el presente`);
      }
      const from = store.lastBlock + 1;
      scannedTo = store.lastBlock;
      if (from <= latest) {
        const to = Math.min(from + logWindow, latest);
        scannedTo = to;
        const pull = async (filter) => {
          try {
            return await contract.queryFilter(filter, from, to);
          } catch (error) {
            if (rpcRateLimited(error)) {
              logWindow = 80;
              throw error;
            }
            if (rpcUnhealthy(error)) {
              throw error;
            }
            return [];
          }
        };
        const signups = await pull(contract.filters.AfiliadoRegistrado());
        const bonuses = await pull(contract.filters.BonoActivacionPagado());
        const commissions = await pull(contract.filters.ComisionGeneracional());
        const pausedEv = await pull(contract.filters.Paused());
        const unpausedEv = await pull(contract.filters.Unpaused());
        const adminExec = await pull(contract.filters.AdminActionExecuted());
        for (const event of signups) {
          const padre = String(event.args?.padre || '');
          const usuario = String(event.args?.usuario || '');
          await notifyWallet(
            padre,
            'signup',
            `Quatrivium Finance: una persona se registró con su código.\nCuenta: ${usuario.slice(0, 6)}…${usuario.slice(-4)}`
          );
        }
        for (const event of bonuses) {
          const padre = String(event.args?.padre || '');
          await notifyWallet(
            padre,
            'commission',
            'Quatrivium Finance: recibió el bono de activación de un referido.'
          );
        }
        for (const event of commissions) {
          const beneficiario = String(event.args?.beneficiario || '');
          await notifyWallet(
            beneficiario,
            'commission',
            'Quatrivium Finance: recibió una comisión de su red.'
          );
          await pagarBoostReserva(event);
        }
        if (pausedEv.length) {
          await alertAdmin(
            'Quatrivium Finance ALERTA: el contrato fue PAUSADO. Préstamos y registros están detenidos.'
          );
        }
        if (unpausedEv.length) {
          await alertAdmin('Quatrivium Finance: el contrato fue despausado.');
        }
        for (const event of adminExec) {
          await alertAdmin(
            `Quatrivium Finance: acción de admin ejecutada ${event.args?.selector || ''}`
          );
        }
        if (reserva) {
          const pullReserva = async (filter) => {
            try {
              return await reserva.queryFilter(filter, from, to);
            } catch (error) {
              if (rpcRateLimited(error) || rpcUnhealthy(error)) throw error;
              return [];
            }
          };
          const locks = await pullReserva(reserva.filters.Bloqueado());
          const unlocks = await pullReserva(reserva.filters.Desbloqueado());
          const pots = await pullReserva(reserva.filters.BoteAportado());
          const boosts = await pullReserva(reserva.filters.BoostComision());
          const rPaused = await pullReserva(reserva.filters.Paused());
          const rUnpaused = await pullReserva(reserva.filters.Unpaused());
          if (locks.length)
            await alertAdmin(`Quatrivium Finance Reserva: ${locks.length} bloqueo(s).`);
          if (unlocks.length)
            await alertAdmin(`Quatrivium Finance Reserva: ${unlocks.length} desbloqueo(s).`);
          if (pots.length)
            await alertAdmin(`Quatrivium Finance Reserva: aporte al bote (${pots.length}).`);
          if (boosts.length)
            await alertAdmin(`Quatrivium Finance Reserva: extra de comisión (${boosts.length}).`);
          if (rPaused.length) {
            await alertAdmin(
              'Quatrivium Finance ALERTA: Reserva PAUSADA. Nuevos locks detenidos; el principal se puede desbloquear.'
            );
          }
          if (rUnpaused.length) await alertAdmin('Quatrivium Finance: Reserva despausada.');
        }
        store.lastBlock = to;
        saveStore(store);
        rateLimitStreak = 0;
        if (logWindow < 200) logWindow = Math.min(200, logWindow + 20);
      }
      if (Date.now() - lastDebtCheck > 60_000) {
        lastDebtCheck = Date.now();
        await scanDebtReminders(contract);
        await guardReservaPause(contract, reserva);
      }
    } catch (error) {
      if (rpcRateLimited(error)) {
        if (scannedTo > store.lastBlock) {
          store.lastBlock = scannedTo;
          saveStore(store);
        }
        rateLimitStreak += 1;
        const waitMs = Math.min(300_000, 45_000 * 2 ** Math.min(rateLimitStreak - 1, 3));
        if (rateLimitStreak === 1 || rateLimitStreak % 4 === 0) {
          console.warn(`Avisos chain: RPC con cupo, espera ${Math.round(waitMs / 1000)}s`);
        }
        try {
          if (Date.now() - lastDebtCheck > 60_000) {
            lastDebtCheck = Date.now();
            await scanDebtReminders(contract);
            await guardReservaPause(contract, reserva);
          }
        } catch {
          // los avisos de deuda se reintentan en el siguiente ciclo
        }
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (rpcUnhealthy(error)) {
        rpcUrl = nextRpc();
        for (let i = 0; i < RPC_CANDIDATES.length; i += 1) {
          if (await probeRpc(rpcUrl)) break;
          rpcUrl = nextRpc();
        }
        provider = makeProvider(rpcUrl);
        setIdentityProvider(rpcUrl);
        contract = new Contract(CONTRACT, ABI, provider);
        reserva = RESERVA ? new Contract(RESERVA, RESERVA_ABI, provider) : null;
        console.error('Avisos chain: RPC caída, se cambia de nodo');
        await new Promise((r) => setTimeout(r, 15000));
        continue;
      }
      console.error('Avisos chain:', error.message || error);
    }
    await new Promise((r) => setTimeout(r, 45000));
  }
};

const sameHash = (left, right) => {
  try {
    const a = Buffer.from(String(left || ''), 'hex');
    const b = Buffer.from(String(right || ''), 'hex');
    if (a.length !== 32 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

const isJsonRequest = (req) => {
  const type = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return type === 'application/json';
};

const requestPath = (req) => String(req.url || '/').split('?')[0];

const bodyError = (res, error) => {
  if (error?.message === 'json') json(res, 400, { error: 'json' });
  else if (error?.message === 'timeout') json(res, 408, { error: 'timeout' });
  else json(res, 413, { error: 'payload' });
};

// TLS lo termina Render/Caddy. Este proceso solo escucha HTTP en el puerto privado.
// deepcode ignore HttpToHttps: private bind; TLS at Render/Caddy
const server = createServer(async (req, res) => {
  // NOSONAR javascript:S5332
  try {
    requestOrigin = String(req.headers.origin || '');
    const path = requestPath(req);
    const isHealth = req.method === 'GET' && path === '/health';
    const isRoot = req.method === 'GET' && path === '/';
    const isTelegramBot = req.method === 'GET' && path === '/telegram/bot';
    // Render (y Fly) sondan /health sin Origin. La raíz GET solo apunta al health.
    if (!isHealth && !isRoot && !isTelegramBot && !originAllowed()) {
      json(res, 403, { error: 'origin' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': corsOrigin(),
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
        ...SECURITY_HEADERS,
      });
      res.end();
      return;
    }
    const ip = clientIp(req);
    if (isRoot) {
      json(res, 200, { ok: true, service: 'quatrivium-notify', health: '/health' });
      return;
    }
    if (isHealth) {
      json(res, 200, { ok: true, kycProvider: hasKycProvider });
      return;
    }
    if (isTelegramBot) {
      if (!rateLimit(ip, 40)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      const bot = await publicTelegramBot();
      json(res, 200, { bot });
      return;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method' });
      return;
    }
    if (!isJsonRequest(req)) {
      json(res, 415, { error: 'type' });
      return;
    }
    if (path === '/profile') {
      if (!rateLimit(ip, 30)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req, 90_000);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let wallet;
      try {
        wallet = requireAuth(body, ['perfil']).wallet;
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      if (String(body.purpose) !== 'perfil') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const prev = store.profiles[wallet] || {};
      const prevName = stripUnsafe(prev.displayName || '', 24);
      const prevPhoto = sanitizePublicPhoto(prev.publicPhoto);
      const locked = Boolean(prev.publicFace && prevName && prevPhoto);
      const incomingName = stripUnsafe(body.displayName || '', 24);
      const incomingPhoto = sanitizePublicPhoto(body.publicPhoto || '');
      const confirming =
        !locked && Boolean(body.publicFace) && Boolean(incomingName) && Boolean(incomingPhoto);
      store.profiles[wallet] = {
        phone: stripUnsafe(body.contactPhone || prev.phone || '', 20),
        whatsapp: stripUnsafe(body.whatsapp || body.contactPhone || prev.whatsapp || '', 20),
        telegramUsername: stripUnsafe(
          String(body.telegramUsername || prev.telegramUsername || '').replace(/^@/, ''),
          32
        ),
        email: prev.email || '',
        prefs: {
          debt: true,
          commission: body.prefs?.commission === true,
          signup: body.prefs?.signup === true,
          email: body.prefs?.email !== false,
        },
        displayName: locked ? prevName : confirming ? incomingName : '',
        username: prev.username || '',
        avatarId: locked
          ? prev.avatarId || 0
          : Number.isFinite(Number(body.avatarId))
            ? Math.max(0, Math.min(7, Number(body.avatarId)))
            : prev.avatarId || 0,
        publicPhoto: locked ? prevPhoto : confirming ? incomingPhoto : '',
        publicFace: locked || confirming,
      };
      await persist();
      json(res, 200, { ok: true });
      return;
    }
    if (path === '/telegram/status') {
      if (!rateLimit(ip, 30)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let statusBody;
      try {
        statusBody = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let statusWallet;
      try {
        statusWallet = requireAuth(statusBody, ['vincular-avisos']).wallet;
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      const offer = liveTelegramOffer(statusWallet);
      json(res, 200, {
        linked: telegramLinked(statusWallet),
        offer: offer ? String(offer.label || '') : '',
      });
      return;
    }
    if (path === '/telegram/accept' || path === '/telegram/reject') {
      if (!rateLimit(ip, 20)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let wallet;
      try {
        wallet = requireAuth(body, ['vincular-avisos']).wallet;
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      if (String(body.purpose) !== 'vincular-avisos') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const key = String(wallet).toLowerCase();
      const offer = liveTelegramOffer(key);
      if (path === '/telegram/reject') {
        if (store.telegramOffers) delete store.telegramOffers[key];
        saveStore(store);
        json(res, 200, { ok: true });
        return;
      }
      if (!offer) {
        json(res, 400, { error: 'offer' });
        return;
      }
      bindTelegram(key, offer.chatId);
      delete store.telegramOffers[key];
      saveStore(store);
      json(res, 200, { linked: true });
      return;
    }
    if (path === '/telegram/prepare') {
      if (!rateLimit(ip, 20)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let wallet;
      try {
        wallet = requireAuth(body, ['vincular-avisos']).wallet;
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      if (String(body.purpose) !== 'vincular-avisos') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      if (telegramLinked(wallet) && body.replace !== true) {
        json(res, 200, { linked: true });
        return;
      }
      store.pendingBinds = store.pendingBinds || {};
      const now = Date.now();
      const walletKey = String(wallet).toLowerCase();
      for (const [code, item] of Object.entries(store.pendingBinds)) {
        if (Number(item?.exp) < now || String(item?.wallet || '').toLowerCase() === walletKey) {
          delete store.pendingBinds[code];
        }
      }
      const pendingCount = Object.keys(store.pendingBinds).length;
      if (pendingCount > 2000) {
        json(res, 429, { error: 'rate' });
        return;
      }
      store.telegramOffers = store.telegramOffers || {};
      const pendingOffer = liveTelegramOffer(walletKey);
      if (pendingOffer && body.replace !== true) {
        await persist();
        json(res, 200, { offer: String(pendingOffer.label || 'Telegram') });
        return;
      }
      const code = randomBytes(6).toString('hex');
      delete store.telegramOffers[walletKey];
      store.pendingBinds[code] = { wallet, exp: now + 10 * 60 * 1000 };
      await persist();
      json(res, 200, { code });
      return;
    }
    if (path === '/otp/request' || path === '/otp/verify') {
      if (!rateLimit(`otp:${ip}`, 12, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['otp']);
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      if (String(body.purpose) !== 'otp') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const wallet = authn.wallet;
      const phone = authn.phone;
      const deviceHash = authn.deviceHash;
      const phoneHash = hashPhone(phone);
      store.otps = store.otps || {};
      store.phoneClaims = store.phoneClaims || {};
      const now = Date.now();
      for (const [key, item] of Object.entries(store.otps)) {
        if (Number(item?.exp) < now) delete store.otps[key];
      }
      const claimed = store.phoneClaims[phoneHash];
      if (claimed && claimed.wallet && claimed.wallet !== wallet && Number(claimed.exp) > now) {
        json(res, 409, { error: 'phone taken' });
        return;
      }
      try {
        await assertIdentityAvailable(phoneHash, deviceHash, wallet);
      } catch (error) {
        json(res, Number(error.status) || 503, { error: error.message || 'identity' });
        return;
      }

      if (path === '/otp/request') {
        if (!rateLimit(`otp-phone:${phoneHash}`, 3, 15 * 60 * 1000)) {
          json(res, 429, { error: 'rate' });
          return;
        }
        if (Object.keys(store.otps).length > 2000) {
          json(res, 429, { error: 'rate' });
          return;
        }
        const code = sixDigitCode();
        const delivery = await deliverOtp(phone, code);
        if (!delivery.channel) {
          json(res, 503, { error: 'delivery' });
          return;
        }
        store.otps[wallet] = {
          phoneHash,
          deviceHash,
          codeHash: delivery.via === 'twilio-verify' ? '' : hashOtp(code, phoneHash, wallet),
          via: delivery.via,
          exp: now + 10 * 60 * 1000,
          attempts: 0,
        };
        await persist();
        json(res, 200, { ok: true, channel: delivery.channel });
        return;
      }

      const pending = store.otps[wallet];
      const code = String(body.code || '').replace(/\D/g, '');
      if (!pending || pending.phoneHash !== phoneHash || pending.deviceHash !== deviceHash) {
        json(res, 400, { error: 'otp' });
        return;
      }
      if (Number(pending.exp) < now) {
        delete store.otps[wallet];
        await persist();
        json(res, 400, { error: 'expired' });
        return;
      }
      const alreadyVerified = pending.verified === true;
      if (!alreadyVerified) {
        pending.attempts = Number(pending.attempts || 0) + 1;
        if (pending.attempts > 5) {
          delete store.otps[wallet];
          await persist();
          json(res, 429, { error: 'rate' });
          return;
        }
        const usesTwilioVerify = pending.via === 'twilio-verify';
        const codeOk = usesTwilioVerify
          ? await checkTwilioVerify(phone, code)
          : sameHash(pending.codeHash, hashOtp(code, phoneHash, wallet));
        if (!codeOk) {
          await persist();
          json(res, 401, { error: 'code' });
          return;
        }
        pending.verified = true;
        pending.attempts = Math.max(0, Number(pending.attempts || 0) - 1);
      }
      try {
        const attestation = await attestIdentity(wallet, phoneHash, deviceHash);
        const prevPhone = store.profiles[wallet]?.verifiedPhone;
        if (prevPhone) {
          const oldHash = hashPhone(prevPhone);
          if (oldHash !== phoneHash && store.phoneClaims[oldHash]?.wallet === wallet) {
            delete store.phoneClaims[oldHash];
          }
        }
        store.phoneClaims[phoneHash] = { wallet, exp: now + IDENTITY_CLAIM_MS };
        const prev = store.profiles[wallet] || {};
        store.profiles[wallet] = { ...prev, verifiedPhone: phone, phoneReleased: false };
        await persist();
        json(res, 200, attestation);
      } catch {
        json(res, 503, { error: 'attester' });
      }
      return;
    }
    if (path === '/email/request' || path === '/email/verify') {
      if (!rateLimit(`email:${ip}`, 12, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['email']);
      } catch (error) {
        json(res, error.message === 'wallet' || error.message === 'email' ? 400 : 401, {
          error: error.message || 'auth',
        });
        return;
      }
      if (String(body.purpose) !== 'email') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const wallet = authn.wallet;
      const email = authn.email;
      const emailHash = hashEmail(authn.emailCanonical || email);
      store.emailOtps = store.emailOtps || {};
      store.emailClaims = store.emailClaims || {};
      const now = Date.now();
      for (const [key, item] of Object.entries(store.emailOtps)) {
        if (Number(item?.exp) < now) delete store.emailOtps[key];
      }
      const claimed = store.emailClaims[emailHash];
      if (claimed && claimed.wallet && claimed.wallet !== wallet && Number(claimed.exp) > now) {
        json(res, 409, { error: 'taken' });
        return;
      }
      if (path === '/email/request') {
        if (!rateLimit(`email-addr:${emailHash}`, 3, 15 * 60 * 1000)) {
          json(res, 429, { error: 'rate' });
          return;
        }
        const code = (() => {
          for (;;) {
            const n = randomBytes(4).readUInt32BE(0);
            if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, '0');
          }
        })();
        store.emailOtps[wallet] = {
          emailHash,
          email,
          codeHash: hashOtp(code, emailHash, wallet),
          exp: now + 10 * 60 * 1000,
          attempts: 0,
        };
        await persist();
        const channel = await deliverEmailOtp(email, code);
        if (!channel) {
          delete store.emailOtps[wallet];
          refundRate(`email:${ip}`);
          refundRate(`email-addr:${emailHash}`);
          await persist();
          console.error(
            'OTP correo: entrega fallida (falta Resend o EMAIL_FROM, o Resend rechazó el envío)'
          );
          json(res, 503, { error: 'delivery' });
          return;
        }
        console.log('OTP correo: enviado');
        json(res, 200, { ok: true, channel });
        return;
      }
      const pending = store.emailOtps[wallet];
      const code = String(body.code || '').replace(/\D/g, '');
      if (!pending || pending.emailHash !== emailHash) {
        json(res, 400, { error: 'otp' });
        return;
      }
      if (Number(pending.exp) < now) {
        delete store.emailOtps[wallet];
        await persist();
        json(res, 400, { error: 'expired' });
        return;
      }
      const alreadyVerified = pending.verified === true;
      if (!alreadyVerified) {
        pending.attempts = Number(pending.attempts || 0) + 1;
        if (pending.attempts > 5) {
          delete store.emailOtps[wallet];
          await persist();
          json(res, 429, { error: 'rate' });
          return;
        }
        if (!sameHash(pending.codeHash, hashOtp(code, emailHash, wallet))) {
          await persist();
          json(res, 401, { error: 'code' });
          return;
        }
        pending.verified = true;
        pending.attempts = Math.max(0, Number(pending.attempts || 0) - 1);
      }
      const prevEmail = store.profiles[wallet]?.email;
      if (prevEmail) {
        const oldHash = hashEmail(parseAllowedEmail(prevEmail).canonical || prevEmail);
        if (oldHash !== emailHash && store.emailClaims[oldHash]?.wallet === wallet) {
          delete store.emailClaims[oldHash];
        }
      }
      store.emailClaims[emailHash] = { wallet, exp: now + IDENTITY_CLAIM_MS };
      const prev = store.profiles[wallet] || {};
      store.profiles[wallet] = { ...prev, email, emailReleased: false };
      await persist();
      json(res, 200, { ok: true });
      return;
    }
    if (
      path === '/identity/status' ||
      path === '/identity/resume' ||
      path === '/identity/release'
    ) {
      if (!rateLimit(`identity:${ip}`, 30, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['identity']);
      } catch (error) {
        json(res, error.message === 'wallet' || error.message === 'device' ? 400 : 401, {
          error: error.message || 'auth',
        });
        return;
      }
      if (String(body.purpose) !== 'identity') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const wallet = authn.wallet;
      if (!rateLimit(`identity-w:${wallet}`, 12, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      store.profiles = store.profiles || {};
      store.emailClaims = store.emailClaims || {};
      store.phoneClaims = store.phoneClaims || {};
      const profile = store.profiles[wallet] || {};
      if (path === '/identity/status') {
        let onChainBound = false;
        try {
          const bound = await readBoundIdentity(wallet);
          onChainBound = hashBound(bound.phoneHash);
        } catch {
          onChainBound = false;
        }
        const emailReleased = Boolean(profile.emailReleased);
        const phoneReleased = Boolean(profile.phoneReleased);
        const email = !emailReleased && profile.email ? String(profile.email) : '';
        const phone = !phoneReleased && profile.verifiedPhone ? String(profile.verifiedPhone) : '';
        json(res, 200, {
          ok: true,
          email,
          phone,
          emailActive: Boolean(email),
          phoneActive: !phoneReleased && (Boolean(phone) || onChainBound),
        });
        return;
      }
      if (path === '/identity/release') {
        const target = String(body.target || '');
        if (target !== 'email' && target !== 'phone') {
          json(res, 400, { error: 'target' });
          return;
        }
        if (target === 'email') {
          if (profile.email) {
            const parsed = parseAllowedEmail(profile.email);
            const oldHash = hashEmail(parsed.canonical || profile.email);
            if (store.emailClaims[oldHash]?.wallet === wallet) delete store.emailClaims[oldHash];
            if (store.recoveryWraps[oldHash]?.wallet === wallet)
              delete store.recoveryWraps[oldHash];
          }
          store.profiles[wallet] = { ...profile, email: '', emailReleased: true };
        } else {
          if (profile.verifiedPhone) {
            const oldPhoneHash = hashPhone(String(profile.verifiedPhone));
            if (store.phoneClaims[oldPhoneHash]?.wallet === wallet)
              delete store.phoneClaims[oldPhoneHash];
          }
          store.profiles[wallet] = { ...profile, verifiedPhone: '', phoneReleased: true };
        }
        await persist();
        json(res, 200, { ok: true });
        return;
      }
      if (Boolean(profile.phoneReleased)) {
        json(res, 409, { error: 'released' });
        return;
      }
      let bound;
      try {
        bound = await readBoundIdentity(wallet);
      } catch {
        json(res, 503, { error: 'identity' });
        return;
      }
      if (!hashBound(bound.phoneHash)) {
        json(res, 404, { error: 'identity' });
        return;
      }
      if (
        String(bound.deviceHash || '').toLowerCase() ===
        String(authn.deviceHash || '').toLowerCase()
      ) {
        json(res, 200, {
          ok: true,
          already: true,
          phoneHash: bound.phoneHash,
          deviceHash: bound.deviceHash,
        });
        return;
      }
      try {
        await assertIdentityAvailable(bound.phoneHash, authn.deviceHash, wallet);
        const attestation = await attestIdentity(wallet, bound.phoneHash, authn.deviceHash);
        json(res, 200, { ok: true, already: false, ...attestation });
      } catch (error) {
        json(res, Number(error.status) || 503, { error: error.message || 'attester' });
      }
      return;
    }
    if (path === '/session/check' || path === '/session/claim') {
      if (!rateLimit(`session:${ip}`, 40, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      store.exclusiveSessions = store.exclusiveSessions || {};
      let authn;
      try {
        authn = requireAuth(body, ['session']);
      } catch (error) {
        json(res, error.message === 'wallet' || error.message === 'device' ? 400 : 401, {
          error: error.message || 'auth',
        });
        return;
      }
      if (String(body.purpose) !== 'session') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      if (path === '/session/check') {
        const current = store.exclusiveSessions[authn.wallet];
        const owner = !current?.deviceHash || current.deviceHash === authn.deviceHash;
        json(res, 200, { owner, vacant: !current?.deviceHash });
        return;
      }
      const claimed = store.exclusiveSessions[authn.wallet];
      if (claimed?.deviceHash && claimed.deviceHash !== authn.deviceHash) {
        const age = Date.now() - Number(claimed.at || 0);
        if (age < 60 * 60 * 1000) {
          json(res, 429, { error: 'cooldown' });
          return;
        }
      }
      store.exclusiveSessions[authn.wallet] = { deviceHash: authn.deviceHash, at: Date.now() };
      await persist();
      json(res, 200, { ok: true, owner: true });
      return;
    }
    if (path === '/username/check' || path === '/username/claim') {
      if (!rateLimit(`username:${ip}`, 20, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['username']);
      } catch (error) {
        json(res, error.message === 'wallet' || error.message === 'username' ? 400 : 401, {
          error: error.message || 'auth',
        });
        return;
      }
      if (String(body.purpose) !== 'username') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const username = authn.username;
      store.usernameClaims = store.usernameClaims || {};
      const holder = store.usernameClaims[username];
      const taken = Boolean(holder && holder.wallet && holder.wallet !== authn.wallet);
      if (path === '/username/check') {
        json(res, taken ? 409 : 200, { available: !taken, error: taken ? 'taken' : undefined });
        return;
      }
      if (taken) {
        json(res, 409, { error: 'taken' });
        return;
      }
      const prevName = store.profiles[authn.wallet]?.username;
      if (
        prevName &&
        prevName !== username &&
        store.usernameClaims[prevName]?.wallet === authn.wallet
      ) {
        delete store.usernameClaims[prevName];
      }
      store.usernameClaims[username] = { wallet: authn.wallet };
      const prev = store.profiles[authn.wallet] || {};
      store.profiles[authn.wallet] = { ...prev, username };
      await persist();
      json(res, 200, { ok: true, username });
      return;
    }
    if (path === '/profiles') {
      if (!rateLimit(`profiles:${ip}`, 20)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      try {
        requireAuth(body, ['perfil']);
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      if (String(body.purpose) !== 'perfil') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const wallets = (Array.isArray(body.wallets) ? body.wallets : [])
        .map((item) =>
          String(item || '')
            .trim()
            .toLowerCase()
        )
        .filter((item) => /^0x[0-9a-f]{40}$/.test(item))
        .slice(0, 20);
      const profiles = {};
      for (const wallet of wallets) {
        const item = store.profiles[wallet];
        if (!item) continue;
        let displayName = stripUnsafe(item.displayName || '', 24);
        const sessionUser = String(item.username || '').trim();
        const publicPhoto = sanitizePublicPhoto(item.publicPhoto);
        // El usuario de entrada no es el apodo. Sin imagen pública no se publica, aunque coincida el texto.
        if (
          !publicPhoto &&
          sessionUser &&
          displayName.toLowerCase() === sessionUser.toLowerCase()
        ) {
          displayName = '';
        }
        if (!displayName && !publicPhoto) continue;
        profiles[wallet] = {
          displayName,
          avatarId: item.avatarId || 0,
          publicPhoto,
          publicFace: Boolean(item.publicFace),
        };
      }
      json(res, 200, { profiles });
      return;
    }
    if (path === '/password/recovery-store') {
      if (!rateLimit(`pwstore:${ip}`, 12, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['perfil']);
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      if (String(body.purpose) !== 'perfil') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const email = store.profiles[authn.wallet]?.email;
      const parsed = parseAllowedEmail(email);
      if (!parsed.canonical) {
        json(res, 400, { error: 'email' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }
    if (path === '/password/recover-request') {
      if (!rateLimit(`pwrecover:${ip}`, 8, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      const parsed = parseAllowedEmail(body.email || body.canonical);
      if (!parsed.canonical) {
        json(res, 400, { error: 'email' });
        return;
      }
      const emailHash = hashEmail(parsed.canonical);
      const now = Date.now();
      const quota = recoverQuotaFor(emailHash, now);
      if (
        Number(quota.attempts) >= RECOVER_DAY_ATTEMPTS ||
        Number(quota.sends) >= RECOVER_DAY_ATTEMPTS
      ) {
        json(res, 429, { error: 'day' });
        return;
      }
      const sinceSent = now - Number(quota.lastSent || 0);
      if (Number(quota.lastSent) > 0 && sinceSent < RECOVER_SEND_WAIT_MS) {
        json(res, 429, {
          error: 'cooldown',
          retry: Math.ceil((RECOVER_SEND_WAIT_MS - sinceSent) / 1000),
        });
        return;
      }
      const previousSent = Number(quota.lastSent || 0);
      quota.sends = Number(quota.sends || 0) + 1;
      quota.lastSent = now;
      try {
        await persist();
      } catch {
        quota.sends = Math.max(0, Number(quota.sends || 0) - 1);
        quota.lastSent = 0;
        json(res, 500, { error: 'store' });
        return;
      }
      store.emailClaims = store.emailClaims || {};
      store.recoverOtps = store.recoverOtps || {};
      const claimed = store.emailClaims[emailHash];
      for (const [key, item] of Object.entries(store.recoverOtps)) {
        if (Number(item?.exp) < now) delete store.recoverOtps[key];
      }
      if (claimed?.wallet) {
        const code = sixDigitCode();
        store.recoverOtps[emailHash] = {
          wallet: claimed.wallet,
          codeHash: hashRecoverOtp(code, emailHash),
          exp: now + 10 * 60 * 1000,
          attempts: 0,
        };
        try {
          await persist();
        } catch {
          delete store.recoverOtps[emailHash];
          json(res, 500, { error: 'store' });
          return;
        }
        const channel = await sendEmail(
          parsed.email,
          'Quatrivium Finance: restablecer contraseña',
          `Quatrivium Finance: su código para restablecer la contraseña es ${code}. Caduca en 10 minutos. No lo comparta.`
        );
        if (!channel) {
          delete store.recoverOtps[emailHash];
          quota.sends = Math.max(0, Number(quota.sends || 0) - 1);
          quota.lastSent = previousSent;
          try {
            await persist();
          } catch {
            console.error('OTP recuperación: no se pudo guardar la devolución del envío');
          }
          json(res, 503, { error: 'delivery' });
          return;
        }
      }
      json(res, 200, { ok: true });
      return;
    }
    if (path === '/password/recover-verify') {
      if (!rateLimit(`pwverify:${ip}`, 12, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      const parsed = parseAllowedEmail(body.email || body.canonical);
      const code = String(body.code || '').replace(/\D/g, '');
      if (!parsed.canonical || !/^\d{6}$/.test(code)) {
        json(res, 401, { error: 'code' });
        return;
      }
      const emailHash = hashEmail(parsed.canonical);
      const now = Date.now();
      const quota = recoverQuotaFor(emailHash, now);
      if (Number(quota.attempts) >= RECOVER_DAY_ATTEMPTS) {
        json(res, 429, { error: 'day' });
        return;
      }
      quota.attempts = Number(quota.attempts || 0) + 1;
      store.recoverOtps = store.recoverOtps || {};
      const pending = store.recoverOtps[emailHash];
      if (!pending || Number(pending.exp) < now) {
        if (pending) delete store.recoverOtps[emailHash];
        await persist();
        json(res, 401, { error: 'code' });
        return;
      }
      pending.attempts = Number(pending.attempts || 0) + 1;
      if (!sameHash(pending.codeHash, hashRecoverOtp(code, emailHash))) {
        await persist();
        json(res, 401, { error: 'code' });
        return;
      }
      delete store.recoverOtps[emailHash];
      try {
        await persist();
      } catch {
        store.recoverOtps[emailHash] = pending;
        json(res, 500, { error: 'store' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }
    if (path === '/auto-fund') {
      // Solo en testnet: fondea la wallet que firma EIP-712. Nunca anónimo.
      if (isMainnet) {
        json(res, 403, { error: 'mainnet: use faucet' });
        return;
      }
      if (!rateLimit(`autofund:${ip}`, 5, 60_000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['autofund']);
      } catch (error) {
        json(res, error.message === 'wallet' || error.message === 'device' ? 400 : 401, {
          error: error.message || 'auth',
        });
        return;
      }
      if (String(body.purpose) !== 'autofund') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const address = getAddress(authn.wallet);
      const MIN_FUND_WEI = 1_000_000_000_000_000n; // 0.001 BNB
      const SEND_WEI = 5_000_000_000_000_000n; // 0.005 BNB
      try {
        if (!ATTESTER_KEY || !identityProvider) {
          json(res, 503, { error: 'not configured' });
          return;
        }
        const balance = await identityProvider.getBalance(address);
        if (balance >= MIN_FUND_WEI) {
          json(res, 200, { funded: false });
          return;
        }
        if (!rateLimit(`autofund-w:${address.toLowerCase()}`, 2, 15 * 60 * 1000)) {
          json(res, 429, { error: 'rate' });
          return;
        }
        if (!rateLimit('autofund-day', 80, 24 * 60 * 60 * 1000)) {
          json(res, 429, { error: 'rate' });
          return;
        }
        const funder = new Wallet(ATTESTER_KEY, identityProvider);
        const funderBal = await identityProvider.getBalance(funder.address);
        if (funderBal < SEND_WEI + MIN_FUND_WEI) {
          console.warn('auto-fund: funder wallet low on BNB testnet —', funder.address);
          json(res, 503, { error: 'funder insufficient' });
          return;
        }
        const tx = await funder.sendTransaction({ to: address, value: SEND_WEI, gasLimit: 21000n });
        await tx.wait(1);
        console.log(`auto-fund: sent 0.005 BNB testnet to ${address} — tx ${tx.hash}`);
        json(res, 200, { funded: true, txHash: tx.hash });
      } catch (fundErr) {
        console.error('auto-fund error:', fundErr.message || fundErr);
        json(res, 503, { error: 'fund failed' });
      }
      return;
    }
    if (path === '/demo-identity') {
      // Solo testnet: atestigua KYC/identidad de demo sin SMS para que el contrato no revierta.
      if (isMainnet) {
        json(res, 403, { error: 'mainnet' });
        return;
      }
      if (!allowDemoIdentity) {
        json(res, 403, { error: 'demo-identity' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['demo-identity']);
      } catch (error) {
        json(res, error.message === 'wallet' ? 400 : 401, { error: error.message || 'auth' });
        return;
      }
      if (String(body.purpose) !== 'demo-identity') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      const wallet = authn.wallet;
      // Ngrok hace que todas las peticiones lleguen como 127.0.0.1: no limitar por IP aquí.
      if (!rateLimit(`demo-id-w:${wallet}`, 20, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      const phoneHash = keccak256(
        toUtf8Bytes(`quatrivium.demo.phone.v1:${DATA_KEY_RAW}:${wallet}`)
      );
      const deviceHash = keccak256(
        toUtf8Bytes(`quatrivium.demo.device.v1:${DATA_KEY_RAW}:${wallet}:${authn.deviceHash}`)
      );
      try {
        await assertIdentityAvailable(phoneHash, deviceHash, wallet);
        const attestation = await attestIdentity(wallet, phoneHash, deviceHash);
        json(res, 200, attestation);
      } catch (error) {
        console.warn('demo-identity:', error.message || error);
        json(res, Number(error.status) || 503, { error: error.message || 'attester' });
      }
      return;
    }
    if (path === '/kyc/provider-token') {
      if (!rateLimit(`kycprov:${ip}`, 8, 15 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['identity']);
      } catch (error) {
        json(res, error.message === 'wallet' || error.message === 'device' ? 400 : 401, {
          error: error.message || 'auth',
        });
        return;
      }
      if (String(body.purpose) !== 'identity') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      if (!rateLimit(`kycprov-w:${authn.wallet}`, 3, 24 * 60 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      try {
        const url = await sumsubProviderLink(authn.wallet);
        json(res, 200, { ok: true, url });
      } catch (error) {
        json(res, Number(error.status) || 503, { error: error.message || 'provider' });
      }
      return;
    }
    if (
      path === '/admin/totp/status' ||
      path === '/admin/totp/enroll' ||
      path === '/admin/totp/confirm' ||
      path === '/admin/totp/verify'
    ) {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        bodyError(res, error);
        return;
      }
      let authn;
      try {
        authn = requireAuth(body, ['admin-totp']);
      } catch (error) {
        json(res, error.message === 'wallet' || error.message === 'device' ? 400 : 401, {
          error: error.message || 'auth',
        });
        return;
      }
      if (String(body.purpose) !== 'admin-totp') {
        json(res, 401, { error: 'purpose' });
        return;
      }
      if (!CONTRACT || !identityProvider) {
        json(res, 503, { error: 'contract' });
        return;
      }
      const wallet = getAddress(authn.wallet);
      const key = wallet.toLowerCase();
      try {
        const credit = new Contract(
          CONTRACT,
          ['function admins(address) view returns (bool)'],
          identityProvider
        );
        if (!(await credit.admins(wallet))) {
          json(res, 403, { error: 'admin' });
          return;
        }
      } catch {
        json(res, 503, { error: 'admin' });
        return;
      }
      if (!store.adminTotp || typeof store.adminTotp !== 'object') store.adminTotp = {};
      const row = store.adminTotp[key] || {};
      if (path === '/admin/totp/status') {
        json(res, 200, {
          enrolled: Boolean(row.confirmed && row.secret),
          pending: Boolean(row.secret && !row.confirmed),
        });
        return;
      }
      if (path === '/admin/totp/enroll') {
        if (row.confirmed && row.secret) {
          json(res, 200, { enrolled: true });
          return;
        }
        if (!rateLimit(`totp-enroll:${key}`, 3, 60 * 60 * 1000)) {
          json(res, 429, { error: 'rate' });
          return;
        }
        const secret = generateAdminTotpSecret();
        store.adminTotp[key] = { secret, confirmed: false, at: Date.now() };
        await persist();
        json(res, 200, { secret, uri: adminTotpUrl(secret, wallet), enrolled: false });
        return;
      }
      if (!rateLimit(`totp-try:${key}`, 8, 10 * 60 * 1000)) {
        json(res, 429, { error: 'rate' });
        return;
      }
      const code = String(body.code || '');
      if (path === '/admin/totp/confirm') {
        if (!row.secret || row.confirmed) {
          json(res, 400, { error: 'enroll' });
          return;
        }
        if (!verifyAdminTotp(row.secret, code)) {
          json(res, 401, { error: 'code' });
          return;
        }
        store.adminTotp[key] = { secret: row.secret, confirmed: true, at: Date.now() };
        await persist();
        json(res, 200, { ok: true });
        return;
      }
      if (!row.confirmed || !row.secret || !verifyAdminTotp(row.secret, code)) {
        json(res, 401, { error: 'code' });
        return;
      }
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (error) {
    console.error('notify http:', error?.message || error);
    if (!res.headersSent) json(res, 500, { error: 'server' });
  }
});

server.requestTimeout = 45_000;
server.headersTimeout = 46_000;
server.maxHeadersCount = 40;
server.listen(PORT, BIND, () => {
  console.log(`Avisos Quatrivium Finance en http://${BIND}:${PORT}`);
  console.log(`Red: ${isMainnet ? 'mainnet' : 'testnet'} chain ${CHAIN_ID}`);
  console.log(
    `Correo Resend: ${hasEmail ? 'listo' : 'omitido (sin dominio/Resend; el SMS no lo necesita)'}`
  );
  console.log(`SMS Textbelt: ${hasTextbelt ? 'listo' : 'no configurado'}`);
  console.log(
    `SMS Twilio: ${TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM ? 'listo' : 'no configurado'}`
  );
  try {
    if (attesterReady) console.log(`Attester de firma: ${new Wallet(ATTESTER_KEY).address}`);
    else console.warn('Sin attester: el SMS puede salir y el crédito no vincula el número.');
  } catch {
    console.warn('Attester de firma: llave inválida');
  }
  console.log(`Reserva guardian: ${RESERVA || 'sin dirección (Demo práctica local)'}`);
  console.log(
    `KYC proveedor: ${hasKycProvider ? 'listo (Sumsub en Render)' : 'declaración de la app'}`
  );
});

pollTelegram().catch((error) => console.error(error));
watchChain().catch((error) => console.error(error));
