import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  advanceWait,
  agreedChainMs,
  isPinLengthOk,
  isWeakPin,
  lockoutMs,
  startWait,
  type WaitClock,
} from '../utils/pinPolicy';
import {
  PIN_DEVICE,
  PIN_KDF,
  PIN_PBKDF2_ROUNDS,
  PIN_SPLIT,
  boundPin,
  derivePinMaterial,
  deriveWidePinMaterial,
  pbkdf2Sha256Hex,
  wrapStoreMode,
} from '../utils/pinKdf';
import {
  ackDeviceRepair,
  commitStagedDeviceSecret,
  ensureDeviceSecret,
  loadDeviceSecret,
  phoneHasScreenLock,
  peekDeviceRetry,
  readDeviceGuard,
  readStagedDeviceSecret,
  restoreDeviceRetry,
  stageNewDeviceSecret,
} from '../utils/deviceSecret';
import {
  assertSessionBeforePinWrite,
  isWideKdf,
  legacyPasswordWrap,
  legacyPinWrapRounds,
  migrateSealedValue,
  pinVerifier,
  verifierMatches,
  wrapKeyFromPbkdf2,
  type LockStore,
} from '../utils/lockMigration';
import { resolveBiometricAvailability, type BiometricAvailability } from '../utils/biometricStatus';
import {
  isValidMasterPassword,
  masterPasswordFromRandomBytes,
  masterPasswordReject,
  PASSWORD_LENGTH,
} from '../utils/passwordPolicy';
import {
  deriveWrapKeyAsync,
  isSealedBlob,
  openSecret,
  sealSecret,
  timingSafeEqualHex,
} from '../utils/secretBox';
import { APP_DISPLAY_NAME } from '../constants/brand';
import { getProductMode, publicRpcList } from '../constants/rpcConfig';
import { allowWalletAsyncFallback } from '../utils/walletVaultPolicy';
import { BOUND_UNKNOWN, getBoundWallet } from './deviceBinding';
import { clearWalletSession, getWalletWrapKey, setWalletWrapKey } from './walletSession';
import { externalWalletHandoffActive } from './walletHandoff';
import { isPickerHeld } from '../utils/pickerHold';
import { reportLockFault } from '../utils/lockRace';
import { sha256, toUtf8Bytes } from 'ethers';
import { storeSlot } from '../utils/storeSlot';

const PIN_KEY = storeSlot(['quatrivium', 'lock', 'pin']);
const PASSWORD_KEY = storeSlot(['quatrivium', 'lock', 'password']);
const PASSWORD_FALLBACK = storeSlot(['quatrivium', 'lock', 'password', 'fallback']);
const PIN_WRAP_KEY = storeSlot(['quatrivium', 'lock', 'pinWrap']);
const PIN_WRAP_NEXT = storeSlot(['quatrivium', 'lock', 'pinWrap', 'next']);
const BIO_KEY = storeSlot(['quatrivium', 'lock', 'bio']);
const LOCK_OPEN_KEY = storeSlot(['quatrivium', 'lock', 'onOpen']);
const GATE_KEY = storeSlot(['quatrivium', 'lock', 'gate']);
const ATTEMPT_KEY = storeSlot(['quatrivium', 'lock', 'attempts']);
const WRAP_STORE = storeSlot(['quatrivium', 'wallet', 'wrap', 'v1']);
const RECOVERY_WRAP = storeSlot(['quatrivium', 'lock', 'recoveryWrap']);
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const BIO_WRAP_OPTIONS = {
  ...OPTIONS,
  requireAuthentication: true,
  authenticationPrompt: APP_DISPLAY_NAME,
};

export const PIN_LENGTH = 6;
/** Diez PIN seguidos mal: el PIN se bloquea y solo abre la contraseña. No se borra nada. */
export const PIN_FAIL_LIMIT = 10;
/** Diez TOTP seguidos mal: el autenticador no desbloquea; abren la contraseña o la frase. */
export const TOTP_FAIL_LIMIT = 10;
/** Presupuesto interno de una verificación (sin contar avisos del sistema). */
const VERIFY_INTERNAL_MS = 20_000;
let verifyBudgetMs = VERIFY_INTERNAL_MS;
export { PASSWORD_LENGTH, isValidMasterPassword };
export const PIN_ROUNDS = 20_000;
const BACKGROUND_LOCK_MS = 20_000;

interface PinRecord {
  v?: number;
  salt: string;
  hash: string;
  rounds?: number;
  kdf?: string;
  split?: number;
  device?: number;
  deviceAuth?: number;
}

interface AttemptRecord {
  pin: number;
  password: number;
  totp: number;
}

interface PasswordRecord {
  v: 1;
  salt: string;
  hash: string;
  rounds: number;
  kdf?: string;
  split?: number;
}

interface GateRecord {
  fails: number;
  until: number;
  waitMs: number;
  left: number;
  seen: number;
  chainAt: number;
  /** Última hora de cadena aceptada. Una muestra más vieja no cuenta: la cadena solo avanza. */
  lastChain: number;
}

let monoClockForTests: (() => number) | null = null;
let chainStampsForTests: (() => Promise<(number | null)[]> | (number | null)[]) | null = null;
let beforeVerifyForTests: (() => Promise<void> | void) | null = null;
let afterMatchForTests: (() => Promise<void> | void) | null = null;
let anchorTail: Promise<void> = Promise.resolve();
let anchorTimer: ReturnType<typeof setTimeout> | null = null;
let lastLockLeft = 0;
let verifying = false;
let passwordBackup: { secure: string | null; fallback: string | null } | null = null;
let passwordReplaceToken: string | null = null;
const STORE_UNKNOWN = Symbol('store-unknown');

function busyResult(): PinCheck {
  return { ok: false, remainingMs: 0, locked: false, busy: true };
}

function withVerifyBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('lock-verify-timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Solo pruebas: acorta el presupuesto interno de withLockVerify. */
export function setVerifyBudgetForTests(ms: number | null): void {
  verifyBudgetMs = ms == null ? VERIFY_INTERNAL_MS : Math.max(50, ms);
}

/** Mientras un PIN, una contraseña o un TOTP se comprueban, el resto no toca el candado. */
export async function withLockVerify<T>(job: () => Promise<T>, busy: T): Promise<T> {
  if (verifying) return busy;
  verifying = true;
  try {
    return await withVerifyBudget(Promise.resolve().then(job), verifyBudgetMs);
  } finally {
    verifying = false;
  }
}

function timeoutCheckResult(): PinCheck {
  return {
    ok: false,
    remainingMs: lastLockLeft,
    locked: lastLockLeft > 0,
  };
}

/** Solo pruebas: cortar entre el intento guardado y PBKDF2, o entre el acierto y la limpieza. */
export function setLockPhaseForTests(
  phase: {
    beforeVerify?: (() => Promise<void> | void) | null;
    afterMatch?: (() => Promise<void> | void) | null;
  } | null
): void {
  beforeVerifyForTests = phase?.beforeVerify ?? null;
  afterMatchForTests = phase?.afterMatch ?? null;
}

/** La lectura de cadena posterior al fallo. La respuesta en pantalla no la espera. */
export function whenLockAnchorSettled(): Promise<void> {
  return anchorTail;
}

/** Solo pruebas: performance.now() mientras la app está abierta. */
export function setMonoClockForTests(clock: (() => number) | null): void {
  monoClockForTests = clock;
  lastChainMono = -CHAIN_POLL_MS;
  chainFlight = null;
  gateQueue = Promise.resolve();
  anchorTail = Promise.resolve();
  if (anchorTimer) {
    clearTimeout(anchorTimer);
    anchorTimer = null;
  }
  lastLockLeft = 0;
  verifying = false;
  verifyBudgetMs = VERIFY_INTERNAL_MS;
  passwordReplaceToken = null;
  passwordBackup = null;
  beforeVerifyForTests = null;
  afterMatchForTests = null;
}

/**
 * Solo pruebas: sellos de bloque ya en milisegundos.
 * null vuelve a leer los RPC públicos.
 */
export function setChainStampsForTests(
  reader: (() => Promise<(number | null)[]> | (number | null)[]) | null
): void {
  chainStampsForTests = reader;
}

function monoNow(): number {
  return monoClockForTests ? monoClockForTests() : performance.now();
}

async function hashSecret(secret: string, salt: string, rounds: number): Promise<string> {
  let digest = `${salt}:${secret}`;
  const n = Math.max(1, Math.floor(rounds));
  for (let i = 0; i < n; i += 1) {
    digest = sha256(toUtf8Bytes(digest)).slice(2);
    if (i % 250 === 249) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return digest;
}

function digestHex(value: string): string {
  return `0x${String(value || '')
    .replace(/^0x/i, '')
    .toLowerCase()}`;
}

function isSixDigits(pin: string): boolean {
  return isPinLengthOk(pin);
}

async function readPinRecord(): Promise<PinRecord | null> {
  try {
    const raw = await withTimeout(
      SecureStore.getItemAsync(PIN_KEY).catch(() => null),
      1500,
      null
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PinRecord;
    if (!parsed?.salt || !parsed?.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function boundScope(): Promise<string | null | typeof STORE_UNKNOWN> {
  const bound = (await getBoundWallet()).toLowerCase();
  if (bound === BOUND_UNKNOWN) return STORE_UNKNOWN;
  return /^0x[0-9a-f]{40}$/.test(bound) ? bound : null;
}

async function readStoreRaw(key: string): Promise<string | null | typeof STORE_UNKNOWN> {
  return timedRead(SecureStore.getItemAsync(key), 1500);
}

/** La clave vieja era global. Solo se usa si se confirma que no hay billetera vinculada. */
async function readScoped(legacy: string): Promise<string | null | typeof STORE_UNKNOWN> {
  const scope = await boundScope();
  if (scope === STORE_UNKNOWN) return STORE_UNKNOWN;
  if (!scope) return readStoreRaw(legacy);
  const key = storeSlot([legacy, scope]);
  const current = await readStoreRaw(key);
  if (current === STORE_UNKNOWN || current) return current;
  const old = await readStoreRaw(legacy);
  if (old === STORE_UNKNOWN || !old) return old;
  await SecureStore.setItemAsync(key, old, OPTIONS);
  await SecureStore.deleteItemAsync(legacy).catch(() => {});
  return old;
}

async function writeScoped(legacy: string, value: string): Promise<true | typeof STORE_UNKNOWN> {
  const scope = await boundScope();
  if (scope === STORE_UNKNOWN) return STORE_UNKNOWN;
  const key = scope ? storeSlot([legacy, scope]) : legacy;
  await SecureStore.setItemAsync(key, value, OPTIONS);
  return true;
}

function emptyGate(): GateRecord {
  return { fails: 0, until: 0, waitMs: 0, left: 0, seen: 0, chainAt: 0, lastChain: 0 };
}

function gateFromStored(parsed: Partial<GateRecord>): GateRecord | 'corrupt' {
  const fails = Math.max(0, Number(parsed.fails) || 0);
  const waitRaw = Number(parsed.waitMs);
  const seen = Math.max(0, Number(parsed.seen) || 0);
  const chainAt = Math.max(0, Number(parsed.chainAt) || 0);
  const lastChain = Math.max(0, Number(parsed.lastChain) || 0);
  const leftField = Number(parsed.left);
  if (Number.isFinite(leftField) && Number.isFinite(waitRaw)) {
    return {
      fails,
      until: 0,
      waitMs: Math.max(0, waitRaw),
      left: Math.max(0, leftField),
      seen,
      chainAt,
      lastChain,
    };
  }
  const until = Math.max(0, Number(parsed.until) || 0);
  if (until > 0 && fails > 0) {
    const full = lockoutMs(fails);
    return { fails, until: 0, waitMs: full, left: full, seen: 0, chainAt: 0, lastChain: 0 };
  }
  if (fails > 0) return 'corrupt';
  return emptyGate();
}

function recoveredNumber(raw: string, field: string): number | null {
  const match = new RegExp(`"${field}"\\s*:\\s*(\\d+)`).exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Una muestra más vieja que la última aceptada no entra: la cadena solo avanza. */
function acceptedChain(gate: GateRecord, chain: number | null): number | null {
  if (chain == null || !(chain > 0)) return null;
  if (gate.lastChain > 0 && chain < gate.lastChain) return null;
  return chain;
}

async function readBlockStamp(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBlockByNumber',
        params: ['latest', false],
      }),
      signal: controller.signal,
    });
    const body = (await response.json()) as { result?: { timestamp?: string } };
    const hex = body.result?.timestamp;
    if (typeof hex !== 'string') return null;
    const seconds = Number.parseInt(hex, 16);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return seconds * 1000;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Como máximo una lectura de cadena por minuto, además del fallo, la apertura y el primer plano. */
export const CHAIN_POLL_MS = 60_000;

let lastChainMono = -CHAIN_POLL_MS;
let chainFlight: Promise<number> | null = null;
let gateQueue: Promise<void> = Promise.resolve();

function withGate<T>(job: () => Promise<T>): Promise<T> {
  const run = gateQueue.then(job, job);
  gateQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Hora del último bloque si dos RPC públicos coinciden. Si no, null: no hay red de confianza. */
async function trustedChainMs(): Promise<number | null> {
  if (chainStampsForTests) return agreedChainMs(await Promise.resolve(chainStampsForTests()));
  const stamps = await Promise.all(publicRpcList().map((url) => readBlockStamp(url)));
  return agreedChainMs(stamps);
}

async function applySample(chain: number | null): Promise<number> {
  const gate = await readGate();
  if (gate === STORE_UNKNOWN) return lastLockLeft;
  if (gate.left <= 0) return rememberLeft(0);
  const fresh = acceptedChain(gate, chain);
  const next: WaitClock = advanceWait(gate, { mono: monoNow(), chain: fresh });
  const lastChain = fresh != null ? fresh : gate.lastChain;
  const stored: GateRecord = { ...gate, ...next, until: 0, lastChain };
  const moved =
    stored.left !== gate.left ||
    stored.seen !== gate.seen ||
    stored.chainAt !== gate.chainAt ||
    stored.lastChain !== gate.lastChain;
  if (moved) await writeGate(stored);
  return rememberLeft(stored.left);
}

type LoadedGate = GateRecord | typeof STORE_UNKNOWN | 'absent' | 'corrupt';

function interpretGate(raw: string): GateRecord | 'corrupt' {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'corrupt';
    return gateFromStored(parsed as Partial<GateRecord>);
  } catch {
    return 'corrupt';
  }
}

/** Lee sin castigar. writeGate confirma con esta lectura para no entrar en bucle. */
async function loadGate(): Promise<LoadedGate> {
  try {
    const raw = await readScoped(GATE_KEY);
    if (raw === STORE_UNKNOWN) return STORE_UNKNOWN;
    if (!raw) return 'absent';
    return interpretGate(raw);
  } catch {
    return STORE_UNKNOWN;
  }
}

async function punishGate(raw: string): Promise<GateRecord | typeof STORE_UNKNOWN> {
  const fails = Math.max(6, recoveredNumber(raw, 'fails') ?? 0);
  const waitMs = lockoutMs(fails);
  const next: GateRecord = {
    fails,
    until: 0,
    waitMs,
    left: waitMs,
    seen: monoNow(),
    chainAt: 0,
    lastChain: 0,
  };
  const ok = await writeGate(next);
  return ok ? next : STORE_UNKNOWN;
}

async function readGate(): Promise<GateRecord | typeof STORE_UNKNOWN> {
  const loaded = await loadGate();
  if (loaded === STORE_UNKNOWN) return STORE_UNKNOWN;
  if (loaded === 'absent') return emptyGate();
  if (loaded === 'corrupt') {
    const raw = await readScoped(GATE_KEY);
    if (raw === STORE_UNKNOWN || !raw) return STORE_UNKNOWN;
    return punishGate(raw);
  }
  return loaded;
}

/** El tic de la pantalla: solo performance.now(). No llama a la red. */
export function tickLockWait(): Promise<number> {
  return withGate(() => applySample(null));
}

/**
 * Lee la cadena si toca. force: al abrir o al volver a primer plano.
 * Si ya hay una lectura en curso, no lanza otra.
 */
export function refreshLockChain(force = false): Promise<number> {
  if (chainFlight) return chainFlight;
  const due = force || monoNow() - lastChainMono >= CHAIN_POLL_MS;
  if (!due) return tickLockWait();
  let flight: Promise<number> = Promise.resolve(0);
  flight = withGate(async () => {
    const gate = await readGate();
    if (gate === STORE_UNKNOWN) return lastLockLeft;
    if (gate.left <= 0) return rememberLeft(0);
    const chain = await trustedChainMs();
    lastChainMono = monoNow();
    return applySample(chain);
  }).finally(() => {
    if (chainFlight === flight) chainFlight = null;
  });
  chainFlight = flight;
  return flight;
}

/** La app pasa a segundo plano: guarda lo ya contado y no sigue con el hueco. */
export function pauseLockWait(): Promise<void> {
  return withGate(async () => {
    const gate = await readGate();
    if (gate === STORE_UNKNOWN || gate.left <= 0) return;
    const next = advanceWait(gate, { mono: monoNow(), chain: null });
    if (next.left !== gate.left || next.seen !== gate.seen || next.chainAt !== gate.chainAt) {
      await writeGate({ ...gate, ...next, until: 0 });
    }
    rememberLeft(next.left);
  });
}

/** La app vuelve: el hueco en segundo plano no cuenta. La cadena se pide aparte. */
export function resumeLockWait(): Promise<void> {
  return withGate(async () => {
    const gate = await readGate();
    if (gate === STORE_UNKNOWN || gate.left <= 0) return;
    const seen = monoNow();
    if (seen === gate.seen) return;
    await writeGate({ ...gate, seen, until: 0 });
  });
}

function rememberLeft(left: number): number {
  lastLockLeft = left;
  return left;
}

function sameGate(a: GateRecord, b: GateRecord): boolean {
  return (
    a.fails === b.fails &&
    a.until === b.until &&
    a.waitMs === b.waitMs &&
    a.left === b.left &&
    a.seen === b.seen &&
    a.chainAt === b.chainAt &&
    a.lastChain === b.lastChain
  );
}

function sameAttempts(a: AttemptRecord, b: AttemptRecord): boolean {
  return a.pin === b.pin && a.password === b.password && a.totp === b.totp;
}

/** Escribe y vuelve a leer. Si no coincide o se agota el tiempo, la escritura no quedó confirmada. */
async function writeGate(next: GateRecord): Promise<boolean> {
  const wrote = await timedRead(writeScoped(GATE_KEY, JSON.stringify(next)), 1500);
  if (wrote === STORE_UNKNOWN) return false;
  const back = await loadGate();
  if (back === STORE_UNKNOWN || back === 'corrupt' || back === 'absent') return false;
  const confirmed = sameGate(back, next);
  if (confirmed) rememberLeft(next.left);
  return confirmed;
}

const EMPTY_ATTEMPTS: AttemptRecord = { pin: 0, password: 0, totp: 0 };

type LoadedAttempts = AttemptRecord | typeof STORE_UNKNOWN | 'absent' | 'corrupt';

function interpretAttempts(raw: string): AttemptRecord | 'corrupt' {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'corrupt';
    const row = parsed as AttemptRecord;
    return {
      pin: Math.max(0, Number(row.pin) || 0),
      password: Math.max(0, Number(row.password) || 0),
      totp: Math.max(0, Number(row.totp) || 0),
    };
  } catch {
    return 'corrupt';
  }
}

async function loadAttempts(): Promise<LoadedAttempts> {
  try {
    const raw = await readScoped(ATTEMPT_KEY);
    if (raw === STORE_UNKNOWN) return STORE_UNKNOWN;
    if (!raw) return 'absent';
    return interpretAttempts(raw);
  } catch {
    return STORE_UNKNOWN;
  }
}

async function punishAttempts(raw: string): Promise<AttemptRecord | typeof STORE_UNKNOWN> {
  const pin = recoveredNumber(raw, 'pin');
  const password = recoveredNumber(raw, 'password');
  const totp = recoveredNumber(raw, 'totp');
  const any = pin != null || password != null || totp != null;
  const next: AttemptRecord = {
    pin: pin ?? (any ? 0 : PIN_FAIL_LIMIT),
    password: password ?? 0,
    totp: totp ?? 0,
  };
  const ok = await writeAttempts(next);
  return ok ? next : STORE_UNKNOWN;
}

async function readAttempts(): Promise<AttemptRecord | typeof STORE_UNKNOWN> {
  const loaded = await loadAttempts();
  if (loaded === STORE_UNKNOWN) return STORE_UNKNOWN;
  if (loaded === 'absent') return { ...EMPTY_ATTEMPTS };
  if (loaded === 'corrupt') {
    const raw = await readScoped(ATTEMPT_KEY);
    if (raw === STORE_UNKNOWN || !raw) return STORE_UNKNOWN;
    return punishAttempts(raw);
  }
  return loaded;
}

async function writeAttempts(next: AttemptRecord): Promise<boolean> {
  const wrote = await timedRead(writeScoped(ATTEMPT_KEY, JSON.stringify(next)), 1500);
  if (wrote === STORE_UNKNOWN) return false;
  const back = await loadAttempts();
  if (back === STORE_UNKNOWN || back === 'corrupt' || back === 'absent') return false;
  return sameAttempts(back, next);
}

/** El acierto limpia el candado. Si la limpieza no se confirma, se reintenta una vez y se avisa. */
export async function clearLockAfterSuccess(): Promise<void> {
  let gateOk = await writeGate(emptyGate());
  let attemptOk = await writeAttempts({ ...EMPTY_ATTEMPTS });
  if (!gateOk) gateOk = await writeGate(emptyGate());
  if (!attemptOk) attemptOk = await writeAttempts({ ...EMPTY_ATTEMPTS });
  if (!gateOk || !attemptOk) reportLockFault();
}

export type ReserveKind = 'pin' | 'password' | 'totp';

export type ReserveResult =
  | { status: 'ok'; left: number; fails: number; attempts: AttemptRecord }
  | { status: 'unknown' }
  | { status: 'wait'; remainingMs: number }
  | { status: 'pin-blocked' }
  | { status: 'totp-blocked' };

/**
 * Una sola pasada dentro de la cola: relee, rechaza o escribe el fallo confirmado.
 * El registro y el secreto del dispositivo se leen antes de llamar aquí.
 */
export async function reserveAttempt(kind: ReserveKind): Promise<ReserveResult> {
  return withGate(async () => {
    const gate = await readGate();
    const attempts = await readAttempts();
    if (gate === STORE_UNKNOWN || attempts === STORE_UNKNOWN) return { status: 'unknown' };
    if (kind === 'pin' && attempts.pin >= PIN_FAIL_LIMIT) return { status: 'pin-blocked' };
    if (kind === 'totp' && attempts.totp >= TOTP_FAIL_LIMIT) return { status: 'totp-blocked' };
    let current = gate;
    if (gate.left > 0) {
      const next = advanceWait(gate, { mono: monoNow(), chain: null });
      current = { ...gate, ...next, until: 0, lastChain: gate.lastChain };
      if (next.left !== gate.left || next.seen !== gate.seen || next.chainAt !== gate.chainAt) {
        await writeGate(current);
      }
      if (next.left > 0) return { status: 'wait', remainingMs: rememberLeft(next.left) };
    }
    const started = startWait(current.fails + 1, monoNow(), 0);
    const attemptNext: AttemptRecord = {
      pin: attempts.pin + (kind === 'pin' ? 1 : 0),
      password: attempts.password + (kind === 'password' ? 1 : 0),
      totp: attempts.totp + (kind === 'totp' ? 1 : 0),
    };
    const gateOk = await writeGate({
      fails: started.fails,
      until: 0,
      waitMs: started.waitMs,
      left: started.left,
      seen: started.seen,
      chainAt: 0,
      lastChain: 0,
    });
    const attemptOk = await writeAttempts(attemptNext);
    if (!gateOk || !attemptOk) return { status: 'unknown' };
    return { status: 'ok', left: started.left, fails: started.fails, attempts: attemptNext };
  });
}

export function anchorLockAttempt(fails: number): void {
  scheduleAnchor(fails);
}

function scheduleAnchor(fails: number): void {
  lastChainMono = monoNow();
  const run = new Promise<void>((resolve) => {
    anchorTimer = setTimeout(() => {
      anchorTimer = null;
      void (async () => {
        try {
          const chain = await trustedChainMs();
          if (chain == null) return;
          await withGate(async () => {
            const gate = await readGate();
            if (
              gate === STORE_UNKNOWN ||
              gate.fails !== fails ||
              gate.left <= 0 ||
              gate.chainAt > 0
            ) {
              return;
            }
            const fresh = acceptedChain(gate, chain);
            if (fresh == null) return;
            const next = advanceWait(gate, { mono: monoNow(), chain: fresh });
            await writeGate({ ...gate, ...next, until: 0, lastChain: fresh });
          });
        } catch {
          /* the miss is already stored */
        } finally {
          resolve();
        }
      })();
    }, 0);
  });
  anchorTail = anchorTail.then(
    () => run,
    () => run
  );
}

function storeUnknownResult(): PinCheck {
  return { ok: false, remainingMs: 0, locked: false, storeUnknown: true };
}

function pinBlockedResult(): PinCheck {
  return { ok: false, remainingMs: 0, locked: true, pinBlocked: true };
}

function parsePasswordRecord(raw: string | null): PasswordRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PasswordRecord;
    if (parsed?.v !== 1 || !parsed.salt || !parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function timedRead<T>(promise: Promise<T>, ms: number): Promise<T | typeof STORE_UNKNOWN> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(STORE_UNKNOWN), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(STORE_UNKNOWN);
      }
    );
  });
}

async function readPasswordRecord(): Promise<PasswordRecord | null> {
  const probed = await probePasswordRecord(1500);
  return probed === STORE_UNKNOWN ? null : probed;
}

async function probePasswordRecord(
  timeoutMs: number
): Promise<PasswordRecord | null | typeof STORE_UNKNOWN> {
  const secureRaw = await timedRead(
    SecureStore.getItemAsync(PASSWORD_KEY).catch(() => {
      throw new Error('secure-store');
    }),
    timeoutMs
  );
  if (secureRaw !== STORE_UNKNOWN) {
    const parsed = parsePasswordRecord(secureRaw);
    if (parsed) {
      void AsyncStorage.removeItem(PASSWORD_FALLBACK).catch(() => {});
      return parsed;
    }
  }
  if (!allowWalletAsyncFallback(getProductMode())) {
    void AsyncStorage.removeItem(PASSWORD_FALLBACK).catch(() => {});
    return secureRaw === STORE_UNKNOWN ? STORE_UNKNOWN : null;
  }
  try {
    const fallback = parsePasswordRecord(await AsyncStorage.getItem(PASSWORD_FALLBACK));
    if (fallback) return fallback;
  } catch {
    /* ignore */
  }
  return secureRaw === STORE_UNKNOWN ? STORE_UNKNOWN : null;
}

/** true = hay clave, false = vacío, null = el almacén no respondió. */
export async function probePasswordSet(timeoutMs = 1500): Promise<boolean | null> {
  const probed = await probePasswordRecord(timeoutMs);
  if (probed === STORE_UNKNOWN) return null;
  return Boolean(probed);
}

export async function isPasswordSet(): Promise<boolean> {
  return (await probePasswordSet()) === true;
}

function passwordRounds(record: PasswordRecord): number {
  const n = Number(record.rounds || PIN_ROUNDS);
  if (!Number.isFinite(n)) return PIN_ROUNDS;
  return Math.max(1, Math.floor(n));
}

function lockStore(): LockStore {
  return {
    get: async (key) => (await SecureStore.getItemAsync(key)) || null,
    set: async (key, value) => {
      await SecureStore.setItemAsync(key, value, OPTIONS);
    },
    del: async (key) => {
      await SecureStore.deleteItemAsync(key);
    },
  };
}

async function pinMaterialInput(pin: string, record: PinRecord): Promise<string> {
  if (record.device !== PIN_DEVICE) return pin;
  const secret = await loadDeviceSecret();
  return boundPin(pin, secret.hex);
}

async function pinSealKey(pin: string, record: PinRecord): Promise<string> {
  const rounds = record.rounds || PIN_PBKDF2_ROUNDS;
  const secret = await pinMaterialInput(pin, record);
  if (record.kdf === PIN_KDF && record.split === PIN_SPLIT) {
    return (await derivePinMaterial(secret, record.salt, rounds)).wrap;
  }
  if (isWideKdf(record)) {
    return (await deriveWidePinMaterial(pin, record.salt, record.rounds || 600_000)).wrap;
  }
  if (record.kdf === PIN_KDF)
    return wrapKeyFromPbkdf2(secret, record.salt, record.rounds || 600_000);
  return deriveWrapKeyAsync(pin, record.salt, legacyPinWrapRounds(record));
}

async function persistPinWrap(pin: string, knownKey?: string): Promise<void> {
  const wrap = getWalletWrapKey();
  const record = await readPinRecord();
  if (!wrap || !record || !isSixDigits(pin)) return;
  const pinKey = knownKey || (await pinSealKey(pin, record));
  await SecureStore.setItemAsync(PIN_WRAP_KEY, sealSecret(wrap, pinKey), OPTIONS);
}

async function unlockWithPinKey(pinKey: string): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(PIN_WRAP_KEY);
  if (raw && isSealedBlob(raw)) {
    try {
      setWalletWrapKey(openSecret(raw, pinKey));
      return Boolean(getWalletWrapKey());
    } catch {
      // La llave nueva puede estar solo en el borrador.
    }
  }
  const staged = await SecureStore.getItemAsync(PIN_WRAP_NEXT);
  if (!staged || !isSealedBlob(staged)) return false;
  setWalletWrapKey(openSecret(staged, pinKey));
  await SecureStore.setItemAsync(PIN_WRAP_KEY, staged, OPTIONS);
  try {
    await SecureStore.deleteItemAsync(PIN_WRAP_NEXT);
  } catch {
    // El vivo ya tiene la llave nueva.
  }
  return Boolean(getWalletWrapKey());
}

async function unlockWithPinWrap(pin: string, record: PinRecord): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(PIN_WRAP_KEY);
    if (!raw || !isSealedBlob(raw)) return false;
    const nextKey = await pinSealKey(pin, record);
    try {
      setWalletWrapKey(openSecret(raw, nextKey));
      return Boolean(getWalletWrapKey());
    } catch {
      const oldKey = await deriveWrapKeyAsync(pin, record.salt, legacyPinWrapRounds(record));
      const wrap = await migrateSealedValue(
        lockStore(),
        PIN_WRAP_KEY,
        `${PIN_WRAP_KEY}:next`,
        [oldKey],
        nextKey
      );
      setWalletWrapKey(wrap);
      return Boolean(getWalletWrapKey());
    }
  } catch {
    return false;
  }
}

export async function generateMasterPassword(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = await Crypto.getRandomBytesAsync(192);
    try {
      return masterPasswordFromRandomBytes(bytes);
    } catch {
      // pocos bytes útiles; repetir
    }
  }
  throw new Error('entropy');
}

function passwordError(password: string): Error {
  const reason = masterPasswordReject(password);
  if (reason === 'private-key') return new Error('password-key');
  return new Error('weak-password');
}

async function resealPinToCurrent(pin: string, record: PinRecord): Promise<void> {
  const session = getWalletWrapKey();
  if (!session) return;
  const secret = await loadDeviceSecret();
  const fresh = await derivePinMaterial(boundPin(pin, secret.hex), record.salt, PIN_PBKDF2_ROUNDS);
  const staged = sealSecret(session, fresh.wrap);
  if (openSecret(staged, fresh.wrap) !== session) throw new Error('migrate-verify');
  await SecureStore.setItemAsync(PIN_WRAP_NEXT, staged, OPTIONS);
  const back = await SecureStore.getItemAsync(PIN_WRAP_NEXT);
  if (!back || openSecret(back, fresh.wrap) !== session) throw new Error('migrate-verify');
  const next: PinRecord = {
    ...record,
    v: 3,
    hash: fresh.verifier,
    rounds: PIN_PBKDF2_ROUNDS,
    kdf: PIN_KDF,
    split: PIN_SPLIT,
    device: PIN_DEVICE,
    deviceAuth: secret.authenticated ? 1 : 0,
  };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(next), OPTIONS);
  await SecureStore.setItemAsync(PIN_WRAP_KEY, back, OPTIONS);
  try {
    await SecureStore.deleteItemAsync(PIN_WRAP_NEXT);
  } catch {
    // El registro y la llave viva ya coinciden.
  }
}

export async function persistWrapForBiometric(wrapKey = getWalletWrapKey()): Promise<boolean> {
  if (!wrapKey) return false;
  try {
    const status = await getBiometricStatus();
    const mode = wrapStoreMode(status.hasHardware && status.enrolled);
    await SecureStore.setItemAsync(
      WRAP_STORE,
      wrapKey,
      mode === 'hardware' ? BIO_WRAP_OPTIONS : OPTIONS
    );
    return true;
  } catch {
    return false;
  }
}

function applyWrap(value: string | null): string | null {
  if (!value) return null;
  setWalletWrapKey(value);
  return getWalletWrapKey();
}

export async function loadWrapFromBiometric(): Promise<string | null> {
  const ok = await authenticateBiometric();
  if (!ok) return null;
  try {
    const stored = await SecureStore.getItemAsync(WRAP_STORE, OPTIONS);
    if (stored) return applyWrap(stored);
  } catch {
    return null;
  }
  return null;
}

export async function clearBiometricWrap(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(WRAP_STORE);
  } catch {
    // ignore
  }
}

export async function persistLocalRecoveryWrap(wrap = getWalletWrapKey()): Promise<void> {
  if (!wrap) return;
  try {
    await SecureStore.setItemAsync(RECOVERY_WRAP, wrap, BIO_WRAP_OPTIONS);
  } catch {
    // El correo no debe depender de un wrap en el worker.
  }
}

export async function loadLocalRecoveryWrap(): Promise<string | null> {
  try {
    const raw = String(
      (await SecureStore.getItemAsync(RECOVERY_WRAP, BIO_WRAP_OPTIONS)) || ''
    ).toLowerCase();
    return /^0x[0-9a-f]{64}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function persistCompanionWraps(wrap = getWalletWrapKey()): Promise<void> {
  if (!wrap) return;
  await persistLocalRecoveryWrap(wrap);
  await withTimeout(
    (async () => {
      try {
        const { isAuthenticatorEnabled, persistAuthenticatorWrap } = await import(
          './authenticator'
        );
        if (await isAuthenticatorEnabled()) {
          await persistAuthenticatorWrap(wrap);
        }
      } catch {
        /* ignore */
      }
    })(),
    1500,
    undefined
  );
}

/** true = hay PIN, false = vacío, null = el almacén no respondió. */
export async function probePinSet(timeoutMs = 1500): Promise<boolean | null> {
  const raw = await timedRead(
    SecureStore.getItemAsync(PIN_KEY).catch(() => {
      throw new Error('secure-store');
    }),
    timeoutMs
  );
  if (raw === STORE_UNKNOWN) return null;
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as PinRecord;
    return Boolean(parsed?.salt && parsed?.hash);
  } catch {
    return false;
  }
}

export async function isPinSet(): Promise<boolean> {
  return (await probePinSet()) === true;
}

export async function getPinLockRemaining(): Promise<number> {
  return refreshLockChain(false);
}

export async function setPin(pin: string): Promise<string> {
  if (!isSixDigits(pin) || isWeakPin(pin)) {
    throw new Error('weak-pin');
  }
  const passwordSet = await isPasswordSet();
  const existingWrap = getWalletWrapKey();
  assertSessionBeforePinWrite(passwordSet, existingWrap);
  const salt = Crypto.randomUUID();
  const secret = await ensureDeviceSecret();
  const material = await derivePinMaterial(boundPin(pin, secret.hex), salt, PIN_PBKDF2_ROUNDS);
  const record: PinRecord = {
    v: 3,
    salt,
    hash: material.verifier,
    rounds: PIN_PBKDF2_ROUNDS,
    kdf: PIN_KDF,
    split: PIN_SPLIT,
    device: PIN_DEVICE,
    deviceAuth: secret.authenticated ? 1 : 0,
  };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record), OPTIONS);
  await setLockOnOpenEnabled(true);
  await writeGate(emptyGate());
  if (passwordSet && existingWrap) {
    await persistPinWrap(pin, material.wrap);
    if (await isBiometricEnabled()) {
      await persistWrapForBiometric(existingWrap);
    }
    await persistCompanionWraps(existingWrap);
    return existingWrap;
  }
  const wrap = material.wrap;
  setWalletWrapKey(wrap);
  if (await isBiometricEnabled()) {
    await persistWrapForBiometric(wrap);
  }
  await persistCompanionWraps(wrap);
  return wrap;
}

export type PinCheck =
  | { ok: true }
  | {
      ok: false;
      remainingMs: number;
      locked: boolean;
      pinBlocked?: boolean;
      deviceAuth?: boolean;
      deviceKeyReset?: boolean;
      deviceSecretLost?: boolean;
      storeUnknown?: boolean;
      busy?: boolean;
      totpBlocked?: boolean;
    };

function pinReady(record: PinRecord): boolean {
  return (
    record.kdf === PIN_KDF &&
    record.split === PIN_SPLIT &&
    record.device === PIN_DEVICE &&
    Number(record.rounds || 0) === PIN_PBKDF2_ROUNDS
  );
}

function deviceCheck(error: unknown): PinCheck {
  if (error instanceof Error && error.message === 'device-auth') {
    return { ok: false, remainingMs: 0, locked: false, deviceAuth: true };
  }
  if (error instanceof Error && error.message === 'device-key-reset') {
    return { ok: false, remainingMs: 0, locked: false, deviceKeyReset: true };
  }
  if (error instanceof Error && error.message === 'device-secret-lost') {
    return { ok: false, remainingMs: 0, locked: false, deviceSecretLost: true };
  }
  throw error;
}

async function checkPinBody(pin: string): Promise<PinCheck> {
  const record = await readPinRecord();
  if (!record) {
    return { ok: false, remainingMs: 0, locked: false };
  }
  const legacy = record.kdf !== PIN_KDF;
  const current = record.kdf === PIN_KDF && record.split === PIN_SPLIT;
  const wide = isWideKdf(record);
  let material: { verifier: string; wrap: string } | null = null;
  let secret = '';
  try {
    secret = await pinMaterialInput(pin, record);
  } catch (error) {
    return deviceCheck(error);
  }
  const reserved = await reserveAttempt('pin');
  if (reserved.status !== 'ok') {
    if (reserved.status === 'unknown') return storeUnknownResult();
    if (reserved.status === 'pin-blocked') return pinBlockedResult();
    if (reserved.status === 'wait') {
      return { ok: false, remainingMs: reserved.remainingMs, locked: true };
    }
    return { ok: false, remainingMs: 0, locked: true };
  }
  if (beforeVerifyForTests) await beforeVerifyForTests();
  try {
    material = current
      ? await derivePinMaterial(secret, record.salt, record.rounds || PIN_PBKDF2_ROUNDS)
      : wide
        ? await deriveWidePinMaterial(pin, record.salt, record.rounds || 600_000)
        : null;
    const hash = material
      ? material.verifier
      : legacy
        ? await hashSecret(pin, record.salt, legacyPinWrapRounds(record))
        : await pinVerifier(secret, record);
    let openedWithStaged = false;
    if (!timingSafeEqualHex(digestHex(hash), digestHex(record.hash))) {
      const staged =
        current && record.device === PIN_DEVICE ? await readStagedDeviceSecret() : null;
      if (staged) {
        const stagedMaterial = await derivePinMaterial(
          boundPin(pin, staged),
          record.salt,
          record.rounds || PIN_PBKDF2_ROUNDS
        );
        if (timingSafeEqualHex(digestHex(stagedMaterial.verifier), digestHex(record.hash))) {
          await commitStagedDeviceSecret(staged);
          material = stagedMaterial;
          openedWithStaged = true;
        }
      }
      if (!openedWithStaged) {
        scheduleAnchor(reserved.fails);
        if (reserved.attempts.pin >= PIN_FAIL_LIMIT) return pinBlockedResult();
        return { ok: false, remainingMs: reserved.left, locked: reserved.left > 0 };
      }
    }
  } catch (error) {
    return deviceCheck(error);
  }
  if (afterMatchForTests) await afterMatchForTests();
  const ready = pinReady(record);
  if (await isPasswordSet()) {
    const opened = material
      ? await unlockWithPinKey(material.wrap)
      : await unlockWithPinWrap(pin, record);
    if (!opened) {
      return { ok: false, remainingMs: 0, locked: false };
    }
    if (!ready) await resealPinToCurrent(pin, record);
  } else if (material) {
    const device = await loadDeviceSecret();
    const fresh = ready
      ? material
      : await derivePinMaterial(boundPin(pin, device.hex), record.salt, PIN_PBKDF2_ROUNDS);
    const { rewrapStoredWallet, walletOpensWith } = await import('./appWallet');
    if (!(await walletOpensWith(fresh.wrap))) {
      const oldSession = await deriveWrapKeyAsync(pin, record.salt, PIN_ROUNDS);
      const oldOne = await deriveWrapKeyAsync(pin, record.salt, legacyPinWrapRounds(record));
      await rewrapStoredWallet([material.wrap, oldSession, oldOne], fresh.wrap);
    }
    if (!ready) {
      const updated: PinRecord = {
        ...record,
        v: 3,
        hash: fresh.verifier,
        rounds: PIN_PBKDF2_ROUNDS,
        kdf: PIN_KDF,
        split: PIN_SPLIT,
        device: PIN_DEVICE,
        deviceAuth: device.authenticated ? 1 : 0,
      };
      await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(updated), OPTIONS);
    }
    setWalletWrapKey(fresh.wrap);
  } else {
    const oldKeys: string[] = [];
    if (record.kdf === PIN_KDF) {
      oldKeys.push(await wrapKeyFromPbkdf2(pin, record.salt, record.rounds || 600_000));
    }
    oldKeys.push(await deriveWrapKeyAsync(pin, record.salt, PIN_ROUNDS));
    oldKeys.push(await deriveWrapKeyAsync(pin, record.salt, legacyPinWrapRounds(record)));
    const device = await loadDeviceSecret();
    const fresh = await derivePinMaterial(
      boundPin(pin, device.hex),
      record.salt,
      PIN_PBKDF2_ROUNDS
    );
    const { rewrapStoredWallet, walletOpensWith } = await import('./appWallet');
    if (!(await walletOpensWith(fresh.wrap))) {
      await rewrapStoredWallet(oldKeys, fresh.wrap);
    }
    const updated: PinRecord = {
      ...record,
      v: 3,
      hash: fresh.verifier,
      rounds: PIN_PBKDF2_ROUNDS,
      kdf: PIN_KDF,
      split: PIN_SPLIT,
      device: PIN_DEVICE,
      deviceAuth: device.authenticated ? 1 : 0,
    };
    await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(updated), OPTIONS);
    setWalletWrapKey(fresh.wrap);
  }
  await clearLockAfterSuccess();
  await persistCompanionWraps();
  await runDeviceRetry(pin);
  return { ok: true };
}

/**
 * El desbloqueo ya está hecho. Si la huella se cancela, la marca vuelve y el aviso sigue.
 * Sin PIN, la contraseña también sella un secreto nuevo: el viejo estuvo en claro.
 */
async function runDeviceRetry(pin: string | null): Promise<void> {
  if (!(await peekDeviceRetry())) return;
  try {
    const outcome = pin ? await retryDeviceProtection(pin) : await retryPasswordProtection();
    if (outcome === 'bound') {
      await SecureStore.deleteItemAsync(storeSlot(['quatrivium', 'lock', 'deviceRetry'])).catch(
        () => {}
      );
    }
  } catch {
    await restoreDeviceRetry();
  }
}

async function retryPasswordProtection(): Promise<'bound' | 'open' | 'no-lock' | 'lost'> {
  const guard = await readDeviceGuard();
  if (guard === 'bound') return 'bound';
  if (!(await phoneHasScreenLock())) return 'no-lock';
  if (await readPinRecord()) return 'lost';
  const hex = await stageNewDeviceSecret();
  await commitStagedDeviceSecret(hex);
  return 'bound';
}

/**
 * El reintento con éxito tira el secreto que estuvo en claro y sella el PIN con uno nuevo.
 * El registro nuevo se guarda antes de sustituir el secreto. Si el proceso cae en medio,
 * el siguiente PIN abre con el borrador y termina el cambio.
 */
async function retryDeviceProtection(
  pin: string
): Promise<'bound' | 'open' | 'no-lock' | 'lost'> {
  const guard = await readDeviceGuard();
  if (guard === 'bound') return 'bound';
  if (!(await phoneHasScreenLock())) return 'no-lock';
  const record = await readPinRecord();
  if (!record || record.device !== PIN_DEVICE || !isSixDigits(pin)) return 'lost';
  const current = await loadDeviceSecret();
  const old = await derivePinMaterial(
    boundPin(pin, current.hex),
    record.salt,
    record.rounds || PIN_PBKDF2_ROUNDS
  );
  if (!timingSafeEqualHex(digestHex(old.verifier), digestHex(record.hash))) return 'lost';
  const hex = await stageNewDeviceSecret();
  const fresh = await derivePinMaterial(boundPin(pin, hex), record.salt, PIN_PBKDF2_ROUNDS);
  const next: PinRecord = {
    ...record,
    v: 3,
    hash: fresh.verifier,
    rounds: PIN_PBKDF2_ROUNDS,
    kdf: PIN_KDF,
    split: PIN_SPLIT,
    device: PIN_DEVICE,
    deviceAuth: 1,
  };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(next), OPTIONS);
  const session = getWalletWrapKey();
  if (session) {
    await SecureStore.setItemAsync(PIN_WRAP_KEY, sealSecret(session, fresh.wrap), OPTIONS);
  }
  await commitStagedDeviceSecret(hex);
  if (!(await isPasswordSet())) setWalletWrapKey(fresh.wrap);
  return 'bound';
}

/** Solo pruebas: el producto llama al reintento desde el acierto del PIN. */
export async function retryDeviceProtectionForTests(
  pin: string
): Promise<'bound' | 'open' | 'no-lock' | 'lost'> {
  return retryDeviceProtection(pin);
}

export async function checkPin(pin: string): Promise<PinCheck> {
  if (!isSixDigits(pin)) {
    return { ok: false, remainingMs: 0, locked: false };
  }
  try {
    return await withLockVerify(() => checkPinBody(pin), busyResult());
  } catch (error) {
    if (error instanceof Error && error.message === 'lock-verify-timeout') {
      return timeoutCheckResult();
    }
    throw error;
  }
}

export async function verifyPin(pin: string): Promise<boolean> {
  const result = await checkPin(pin);
  return result.ok;
}

export async function changePin(current: string, next: string): Promise<boolean> {
  if (isWeakPin(next)) {
    throw new Error('weak-pin');
  }
  const checked = await checkPin(current);
  if (!checked.ok) return false;
  if (await isPasswordSet()) {
    await setPin(next);
    return true;
  }
  const pinBackup = await SecureStore.getItemAsync(PIN_KEY);
  const walletBackup = await SecureStore.getItemAsync(storeSlot(['quatrivium', 'appWallet', 'v1']));
  const oldWrap = getWalletWrapKey();
  try {
    const { rewrapWalletWithNewKey } = await import('./appWallet');
    await rewrapWalletWithNewKey(async () => setPin(next));
    return true;
  } catch {
    if (pinBackup) {
      await SecureStore.setItemAsync(PIN_KEY, pinBackup, OPTIONS);
    }
    if (walletBackup) {
      await SecureStore.setItemAsync(
        storeSlot(['quatrivium', 'appWallet', 'v1']),
        walletBackup,
        OPTIONS
      );
    }
    setWalletWrapKey(oldWrap);
    return false;
  }
}

export async function clearPin(current: string): Promise<boolean> {
  if (!(await isPasswordSet())) {
    throw new Error('need-password');
  }
  const checked = await checkPin(current);
  if (!checked.ok) return false;
  try {
    await SecureStore.deleteItemAsync(PIN_KEY);
  } catch {
    // ignore
  }
  try {
    await SecureStore.deleteItemAsync(PIN_WRAP_KEY);
  } catch {
    // ignore
  }
  await setLockOnOpenEnabled(false);
  await writeGate(emptyGate());
  return true;
}

async function capturePasswordBackup(): Promise<void> {
  let secure: string | null = null;
  let fallback: string | null = null;
  try {
    secure = (await SecureStore.getItemAsync(PASSWORD_KEY)) || null;
  } catch {
    secure = null;
  }
  try {
    fallback = (await AsyncStorage.getItem(PASSWORD_FALLBACK)) || null;
  } catch {
    fallback = null;
  }
  passwordBackup = { secure, fallback };
}

/**
 * Tras comprobar que la frase es de este teléfono, emite un token para sobrescribir
 * la contraseña sin sesión abierta. Guarda una copia exacta del registro anterior.
 */
export async function preparePasswordReplace(): Promise<string> {
  await capturePasswordBackup();
  const token = Crypto.randomUUID();
  passwordReplaceToken = token;
  return token;
}

export async function setPassword(
  password: string,
  conveniencePin?: string,
  options?: { replaceToken?: string; keepLockCounters?: boolean }
): Promise<string> {
  if (!isValidMasterPassword(password)) {
    throw passwordError(password);
  }
  if (conveniencePin && !(await checkPin(conveniencePin)).ok) {
    throw new Error('wrong-pin');
  }
  const existing = await readPasswordRecord();
  if (existing) {
    const sessionOpen = Boolean(getWalletWrapKey());
    const token = options?.replaceToken || '';
    const tokenOk = Boolean(token) && token === passwordReplaceToken;
    if (!sessionOpen && !tokenOk) throw new Error('password-locked');
    if (tokenOk) passwordReplaceToken = null;
  }
  if (!passwordBackup) await capturePasswordBackup();
  const salt = Crypto.randomUUID();
  const material = await derivePinMaterial(password, salt, PIN_PBKDF2_ROUNDS);
  const record: PasswordRecord = {
    v: 1,
    salt,
    hash: material.verifier,
    rounds: PIN_PBKDF2_ROUNDS,
    kdf: PIN_KDF,
    split: PIN_SPLIT,
  };
  const nextWrap = material.wrap;
  const serialized = JSON.stringify(record);
  const stored = await withTimeout(
    SecureStore.setItemAsync(PASSWORD_KEY, serialized, OPTIONS)
      .then(() => true)
      .catch(() => false),
    2500,
    false
  );
  if (stored) {
    await AsyncStorage.removeItem(PASSWORD_FALLBACK).catch(() => {});
  } else if (allowWalletAsyncFallback(getProductMode())) {
    try {
      await AsyncStorage.setItem(PASSWORD_FALLBACK, serialized);
    } catch {
      throw new Error('password-persist');
    }
  } else {
    throw new Error('password-persist');
  }
  const previousWrap = getWalletWrapKey();
  if (previousWrap) {
    const { rewrapWalletWithNewKey } = await import('./appWallet');
    await rewrapWalletWithNewKey(async () => {
      setWalletWrapKey(nextWrap);
      return nextWrap;
    });
  } else {
    setWalletWrapKey(nextWrap);
  }
  if (conveniencePin) {
    await persistPinWrap(conveniencePin);
  }
  if (await isBiometricEnabled()) {
    await persistWrapForBiometric(nextWrap);
  }
  await persistCompanionWraps(nextWrap);
  if (!options?.keepLockCounters) await writeGate(emptyGate());
  return nextWrap;
}

/** Si el alta falla después de guardar la clave, restaura la copia exacta anterior. */
export async function abortPasswordSetup(): Promise<void> {
  const backup = passwordBackup;
  passwordBackup = null;
  passwordReplaceToken = null;
  if (backup) {
    try {
      if (backup.secure) {
        await SecureStore.setItemAsync(PASSWORD_KEY, backup.secure, OPTIONS);
      } else {
        await SecureStore.deleteItemAsync(PASSWORD_KEY);
      }
    } catch {
      /* ignore */
    }
    try {
      if (backup.fallback) {
        await AsyncStorage.setItem(PASSWORD_FALLBACK, backup.fallback);
      } else {
        await AsyncStorage.removeItem(PASSWORD_FALLBACK);
      }
    } catch {
      /* ignore */
    }
  }
  clearWalletSession();
}

async function checkPasswordBody(password: string): Promise<PinCheck> {
  const record = await readPasswordRecord();
  if (!record) {
    return { ok: false, remainingMs: 0, locked: false };
  }
  const reserved = await reserveAttempt('password');
  if (reserved.status !== 'ok') {
    if (reserved.status === 'unknown') return storeUnknownResult();
    if (reserved.status === 'wait') {
      return { ok: false, remainingMs: reserved.remainingMs, locked: true };
    }
    if (reserved.status === 'pin-blocked') return pinBlockedResult();
    return { ok: false, remainingMs: 0, locked: true };
  }
  if (beforeVerifyForTests) await beforeVerifyForTests();
  const modern = record.kdf === PIN_KDF;
  const current = modern && record.split === PIN_SPLIT;
  const wide = isWideKdf(record);
  const rounds = passwordRounds(record);
  const ready = current && rounds >= PIN_PBKDF2_ROUNDS;
  const material = current
    ? await derivePinMaterial(password, record.salt, rounds)
    : wide
      ? await deriveWidePinMaterial(password, record.salt, rounds)
      : null;
  const hash = material
    ? material.verifier
    : modern
      ? await pbkdf2Sha256Hex(password, record.salt, rounds)
      : await hashSecret(password, record.salt, rounds);
  if (!verifierMatches(hash, record.hash)) {
    scheduleAnchor(reserved.fails);
    return { ok: false, remainingMs: reserved.left, locked: reserved.left > 0 };
  }
  if (afterMatchForTests) await afterMatchForTests();
  if (material && ready) {
    setWalletWrapKey(material.wrap);
  } else if (material) {
    const fresh = await derivePinMaterial(password, record.salt, PIN_PBKDF2_ROUNDS);
    const { rewrapStoredWallet } = await import('./appWallet');
    await rewrapStoredWallet([material.wrap], fresh.wrap);
    const next: PasswordRecord = {
      v: 1,
      salt: record.salt,
      hash: fresh.verifier,
      rounds: PIN_PBKDF2_ROUNDS,
      kdf: PIN_KDF,
      split: PIN_SPLIT,
    };
    await SecureStore.setItemAsync(PASSWORD_KEY, JSON.stringify(next), OPTIONS);
    setWalletWrapKey(fresh.wrap);
  } else if (modern) {
    const oldWrap = await wrapKeyFromPbkdf2(password, record.salt, rounds);
    const fresh = await derivePinMaterial(password, record.salt, PIN_PBKDF2_ROUNDS);
    const { rewrapStoredWallet } = await import('./appWallet');
    await rewrapStoredWallet([oldWrap], fresh.wrap);
    const next: PasswordRecord = {
      v: 1,
      salt: record.salt,
      hash: fresh.verifier,
      rounds: PIN_PBKDF2_ROUNDS,
      kdf: PIN_KDF,
      split: PIN_SPLIT,
    };
    await SecureStore.setItemAsync(PASSWORD_KEY, JSON.stringify(next), OPTIONS);
    setWalletWrapKey(fresh.wrap);
  } else {
    const oldWrap = await legacyPasswordWrap(password, record.salt, rounds);
    const fresh = await derivePinMaterial(password, record.salt, PIN_PBKDF2_ROUNDS);
    const { rewrapStoredWallet } = await import('./appWallet');
    await rewrapStoredWallet([oldWrap], fresh.wrap);
    const next: PasswordRecord = {
      v: 1,
      salt: record.salt,
      hash: fresh.verifier,
      rounds: PIN_PBKDF2_ROUNDS,
      kdf: PIN_KDF,
      split: PIN_SPLIT,
    };
    await SecureStore.setItemAsync(PASSWORD_KEY, JSON.stringify(next), OPTIONS);
    setWalletWrapKey(fresh.wrap);
  }
  await clearLockAfterSuccess();
  await ackDeviceRepair();
  void persistCompanionWraps();
  await runDeviceRetry(null);
  return { ok: true };
}

export async function checkPassword(password: string): Promise<PinCheck> {
  if (!password) {
    return { ok: false, remainingMs: 0, locked: false };
  }
  try {
    return await withLockVerify(() => checkPasswordBody(password), busyResult());
  } catch (error) {
    if (error instanceof Error && error.message === 'lock-verify-timeout') {
      return timeoutCheckResult();
    }
    throw error;
  }
}

/** Solo pruebas: deja visible si el TOTP de desbloqueo está bloqueado. */
export async function totpUnlockBlocked(): Promise<boolean> {
  const attempts = await readAttempts();
  if (attempts === STORE_UNKNOWN) return true;
  return attempts.totp >= TOTP_FAIL_LIMIT;
}

export async function changePassword(
  current: string,
  next: string,
  pin?: string
): Promise<boolean> {
  if (!isValidMasterPassword(next)) {
    throw passwordError(next);
  }
  const checked = await checkPassword(current);
  if (!checked.ok) return false;
  await setPassword(next, pin);
  return true;
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BIO_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<boolean> {
  const result = await toggleBiometric(enabled);
  return result.ok;
}

export type BiometricToggleReason =
  | 'no-hardware'
  | 'not-enrolled'
  | 'native-missing'
  | 'no-session'
  | 'store-failed'
  | 'auth-failed';

export type BiometricToggleResult = { ok: true } | { ok: false; reason: BiometricToggleReason };

export async function toggleBiometric(enable: boolean): Promise<BiometricToggleResult> {
  const status = await getBiometricStatus();
  if (!enable) {
    if (status.available) {
      const ok = await authenticateBiometric();
      if (!ok) return { ok: false, reason: 'auth-failed' };
    }
    await SecureStore.setItemAsync(BIO_KEY, '0', OPTIONS);
    await clearBiometricWrap();
    return { ok: true };
  }
  if (status.reason === 'native-missing') return { ok: false, reason: 'native-missing' };
  if (!status.hasHardware) return { ok: false, reason: 'no-hardware' };
  if (!status.enrolled) return { ok: false, reason: 'not-enrolled' };
  if (!getWalletWrapKey()) return { ok: false, reason: 'no-session' };
  const ok = await authenticateBiometric();
  if (!ok) return { ok: false, reason: 'auth-failed' };
  const stored = await persistWrapForBiometric();
  if (!stored) {
    await SecureStore.setItemAsync(BIO_KEY, '0', OPTIONS);
    return { ok: false, reason: 'store-failed' };
  }
  await SecureStore.setItemAsync(BIO_KEY, '1', OPTIONS);
  return { ok: true };
}

export async function isLockOnOpenEnabled(): Promise<boolean> {
  return isPinSet();
}

export async function setLockOnOpenEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LOCK_OPEN_KEY, enabled ? '1' : '0', OPTIONS);
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

const MISSING_BIO: BiometricAvailability = {
  available: false,
  hasHardware: false,
  enrolled: false,
  kinds: [],
  reason: 'native-missing',
};

export async function getBiometricStatus(): Promise<BiometricAvailability> {
  try {
    const LocalAuth = await withTimeout(import('expo-local-authentication'), 2500, null);
    if (!LocalAuth) return MISSING_BIO;
    const hasHardware = await withTimeout(LocalAuth.hasHardwareAsync(), 2000, false);
    const enrolled = await withTimeout(LocalAuth.isEnrolledAsync(), 2000, false);
    const types = await withTimeout(
      LocalAuth.supportedAuthenticationTypesAsync(),
      2000,
      [] as number[]
    );
    const enrolledLevel = await withTimeout(LocalAuth.getEnrolledLevelAsync(), 2000, 0);
    return resolveBiometricAvailability({
      hasHardware,
      enrolled,
      enrolledLevel: typeof enrolledLevel === 'number' ? enrolledLevel : 0,
      types: Array.isArray(types) ? types.map((value) => Number(value)) : [],
    });
  } catch {
    return MISSING_BIO;
  }
}

export async function biometricAvailable(): Promise<boolean> {
  return (await getBiometricStatus()).available;
}

export async function authenticateBiometric(): Promise<boolean> {
  try {
    const LocalAuth = await import('expo-local-authentication');
    const result = await LocalAuth.authenticateAsync({
      promptMessage: APP_DISPLAY_NAME,
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
      requireConfirmation: false,
      biometricsSecurityLevel: 'strong',
    });
    return result.success === true;
  } catch {
    return false;
  }
}

export function lockNow(): void {
  clearWalletSession();
}

export function shouldRelockAfterBackground(
  backgroundedAt: number | null,
  now = Date.now(),
  monoAt: number | null = null,
  mono = performance.now()
): boolean {
  if (isPickerHeld(mono)) return false;
  if (backgroundedAt == null) return false;
  if (now < backgroundedAt) return true;
  if (externalWalletHandoffActive()) return false;
  if (now - backgroundedAt >= BACKGROUND_LOCK_MS) return true;
  if (monoAt == null) return false;
  if (mono < monoAt) return true;
  return mono - monoAt >= BACKGROUND_LOCK_MS;
}
