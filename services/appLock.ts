import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { isPinLengthOk, isWeakPin, lockoutMs, remainingLockMs } from '../utils/pinPolicy';
import {
  PIN_KDF,
  PIN_PBKDF2_ROUNDS,
  PIN_SPLIT,
  derivePinMaterial,
  deriveWidePinMaterial,
  pbkdf2Sha256Hex,
  wrapStoreMode,
} from '../utils/pinKdf';
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
import { getProductMode } from '../constants/rpcConfig';
import { allowWalletAsyncFallback } from '../utils/walletVaultPolicy';
import { clearWalletSession, getWalletWrapKey, setWalletWrapKey } from './walletSession';
import { externalWalletHandoffActive } from './walletHandoff';
import { isPickerHeld } from '../utils/pickerHold';
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
const WRAP_STORE = storeSlot(['quatrivium', 'wallet', 'wrap', 'v1']);
const RECOVERY_WRAP = storeSlot(['quatrivium', 'lock', 'recoveryWrap']);
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const BIO_WRAP_OPTIONS = {
  ...OPTIONS,
  requireAuthentication: true,
  authenticationPrompt: APP_DISPLAY_NAME,
};

export const PIN_LENGTH = 6;
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

async function readGate(): Promise<GateRecord> {
  try {
    const raw = await withTimeout(
      SecureStore.getItemAsync(GATE_KEY).catch(() => null),
      1500,
      null
    );
    if (!raw) return { fails: 0, until: 0 };
    const parsed = JSON.parse(raw) as GateRecord;
    return {
      fails: Math.max(0, Number(parsed.fails) || 0),
      until: Math.max(0, Number(parsed.until) || 0),
    };
  } catch {
    return { fails: 0, until: 0 };
  }
}

async function writeGate(next: GateRecord): Promise<void> {
  await withTimeout(
    SecureStore.setItemAsync(GATE_KEY, JSON.stringify(next), OPTIONS),
    1500,
    undefined
  );
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

const STORE_UNKNOWN = Symbol('store-unknown');

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

async function pinHashMatches(pin: string): Promise<boolean> {
  const record = await readPinRecord();
  if (!record || !isSixDigits(pin)) return false;
  const hash =
    record.kdf === PIN_KDF
      ? await pinVerifier(pin, record)
      : await hashSecret(pin, record.salt, legacyPinWrapRounds(record));
  return verifierMatches(hash, record.hash);
}

async function pinSealKey(pin: string, record: PinRecord): Promise<string> {
  const rounds = record.rounds || PIN_PBKDF2_ROUNDS;
  if (record.kdf === PIN_KDF && record.split === PIN_SPLIT) {
    return (await derivePinMaterial(pin, record.salt, rounds)).wrap;
  }
  if (isWideKdf(record)) {
    return (await deriveWidePinMaterial(pin, record.salt, record.rounds || 600_000)).wrap;
  }
  if (record.kdf === PIN_KDF) return wrapKeyFromPbkdf2(pin, record.salt, record.rounds || 600_000);
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
  const fresh = await derivePinMaterial(pin, record.salt, PIN_PBKDF2_ROUNDS);
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
  const gate = await readGate();
  return remainingLockMs(gate.until);
}

export async function setPin(pin: string): Promise<string> {
  if (!isSixDigits(pin) || isWeakPin(pin)) {
    throw new Error('weak-pin');
  }
  const passwordSet = await isPasswordSet();
  const existingWrap = getWalletWrapKey();
  assertSessionBeforePinWrite(passwordSet, existingWrap);
  const salt = Crypto.randomUUID();
  const material = await derivePinMaterial(pin, salt, PIN_PBKDF2_ROUNDS);
  const record: PinRecord = {
    v: 3,
    salt,
    hash: material.verifier,
    rounds: PIN_PBKDF2_ROUNDS,
    kdf: PIN_KDF,
    split: PIN_SPLIT,
  };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(record), OPTIONS);
  await setLockOnOpenEnabled(true);
  await writeGate({ fails: 0, until: 0 });
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

export type PinCheck = { ok: true } | { ok: false; remainingMs: number; locked: boolean };

export async function checkPin(pin: string): Promise<PinCheck> {
  if (!isSixDigits(pin)) {
    return { ok: false, remainingMs: 0, locked: false };
  }
  const remaining = await getPinLockRemaining();
  if (remaining > 0) {
    return { ok: false, remainingMs: remaining, locked: true };
  }
  const record = await readPinRecord();
  if (!record) {
    return { ok: false, remainingMs: 0, locked: false };
  }
  const legacy = record.kdf !== PIN_KDF;
  const current = record.kdf === PIN_KDF && record.split === PIN_SPLIT;
  const wide = isWideKdf(record);
  const material = current
    ? await derivePinMaterial(pin, record.salt, record.rounds || PIN_PBKDF2_ROUNDS)
    : wide
      ? await deriveWidePinMaterial(pin, record.salt, record.rounds || 600_000)
      : null;
  const hash = material
    ? material.verifier
    : legacy
      ? await hashSecret(pin, record.salt, legacyPinWrapRounds(record))
      : await pinVerifier(pin, record);
  if (!timingSafeEqualHex(digestHex(hash), digestHex(record.hash))) {
    const gate = await readGate();
    const fails = gate.fails + 1;
    const until = Date.now() + lockoutMs(fails);
    await writeGate({ fails, until });
    return { ok: false, remainingMs: remainingLockMs(until), locked: remainingLockMs(until) > 0 };
  }
  if (await isPasswordSet()) {
    const opened = material
      ? await unlockWithPinKey(material.wrap)
      : await unlockWithPinWrap(pin, record);
    if (!opened) {
      return { ok: false, remainingMs: 0, locked: false };
    }
    const ready = current && Number(record.rounds || 0) >= PIN_PBKDF2_ROUNDS;
    if (!ready) await resealPinToCurrent(pin, record);
    await writeGate({ fails: 0, until: 0 });
  } else if (material) {
    const ready = current && Number(record.rounds || 0) >= PIN_PBKDF2_ROUNDS;
    const fresh = ready ? material : await derivePinMaterial(pin, record.salt, PIN_PBKDF2_ROUNDS);
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
      };
      await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(updated), OPTIONS);
    }
    setWalletWrapKey(fresh.wrap);
    await writeGate({ fails: 0, until: 0 });
  } else {
    const oldKeys: string[] = [];
    if (record.kdf === PIN_KDF) {
      oldKeys.push(await wrapKeyFromPbkdf2(pin, record.salt, record.rounds || 600_000));
    }
    oldKeys.push(await deriveWrapKeyAsync(pin, record.salt, PIN_ROUNDS));
    oldKeys.push(await deriveWrapKeyAsync(pin, record.salt, legacyPinWrapRounds(record)));
    const fresh = await derivePinMaterial(pin, record.salt, PIN_PBKDF2_ROUNDS);
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
    };
    await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(updated), OPTIONS);
    setWalletWrapKey(fresh.wrap);
    await writeGate({ fails: 0, until: 0 });
  }
  await persistCompanionWraps();
  return { ok: true };
}

export async function matchPin(pin: string): Promise<boolean> {
  if (!isSixDigits(pin)) return false;
  return pinHashMatches(pin);
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
  await writeGate({ fails: 0, until: 0 });
  return true;
}

export async function setPassword(password: string, conveniencePin?: string): Promise<string> {
  if (!isValidMasterPassword(password)) {
    throw passwordError(password);
  }
  if (conveniencePin && !(await pinHashMatches(conveniencePin))) {
    throw new Error('wrong-pin');
  }
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
  await writeGate({ fails: 0, until: 0 });
  return nextWrap;
}

/** Si el alta falla después de guardar la clave, no dejar candado huérfano. */
export async function abortPasswordSetup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PASSWORD_FALLBACK);
  } catch {
    /* ignore */
  }
  try {
    await SecureStore.deleteItemAsync(PASSWORD_KEY);
  } catch {
    /* ignore */
  }
  clearWalletSession();
}

export async function checkPassword(password: string): Promise<PinCheck> {
  if (!password) {
    return { ok: false, remainingMs: 0, locked: false };
  }
  const remaining = await getPinLockRemaining();
  if (remaining > 0) {
    return { ok: false, remainingMs: remaining, locked: true };
  }
  const record = await readPasswordRecord();
  if (!record) {
    return { ok: false, remainingMs: 0, locked: false };
  }
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
    const gate = await readGate();
    const fails = gate.fails + 1;
    const until = Date.now() + lockoutMs(fails);
    await writeGate({ fails, until });
    return { ok: false, remainingMs: remainingLockMs(until), locked: remainingLockMs(until) > 0 };
  }
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
  await writeGate({ fails: 0, until: 0 });
  void persistCompanionWraps();
  return { ok: true };
}

export async function matchPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const record = await readPasswordRecord();
  if (!record) return false;
  const rounds = passwordRounds(record);
  const hash =
    record.kdf === PIN_KDF && record.split === PIN_SPLIT
      ? (await derivePinMaterial(password, record.salt, rounds)).verifier
      : record.kdf === PIN_KDF
        ? await pbkdf2Sha256Hex(password, record.salt, rounds)
        : await hashSecret(password, record.salt, rounds);
  return verifierMatches(hash, record.hash);
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
  now = Date.now()
): boolean {
  if (externalWalletHandoffActive(now) || isPickerHeld()) return false;
  return Boolean(backgroundedAt && now - backgroundedAt >= BACKGROUND_LOCK_MS);
}
