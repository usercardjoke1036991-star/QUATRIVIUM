import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { APP_DISPLAY_NAME } from '../constants/brand';
import { getProductMode } from '../constants/rpcConfig';
import { storeSlot } from './storeSlot';

const SECRET_KEY = storeSlot(['quatrivium', 'lock', 'deviceSecret']);
const AUTH_KEY = storeSlot(['quatrivium', 'lock', 'deviceAuth']);
const REPAIR_KEY = storeSlot(['quatrivium', 'lock', 'deviceRepair']);

const PLAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/**
 * Expo 54, SecureStore.requireAuthentication. No añade módulos nativos.
 * Android pide credencial en leer y en escribir. iOS la pide al leer.
 * Expo Go lo rechaza si hay biometría y falta NSFaceIDUsageDescription.
 * Sin bloqueo de pantalla, el llavero también lo rechaza.
 * En cuenta real eso se avisa: el secreto sigue, pero sin el candado del sistema.
 * No se escribe otro secreto encima de uno que ya existe.
 */
const AUTH = {
  ...PLAIN,
  requireAuthentication: true,
  authenticationPrompt: APP_DISPLAY_NAME,
};

export type DeviceSecret = { hex: string; authenticated: boolean; repair?: boolean };

export type DeviceGuard = 'bound' | 'open' | 'repair' | 'reset' | 'lost' | 'confirm';

let screenLockForTests: (() => Promise<boolean>) | null = null;

/** Solo pruebas. En el teléfono se usa el nivel de bloqueo de Expo. */
export function setScreenLockForTests(probe: (() => Promise<boolean>) | null): void {
  screenLockForTests = probe;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isHex32(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{64}$/.test(value));
}

function authError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/invalidat|keystore reset|permanently/i.test(message)) return new Error('device-key-reset');
  return new Error('device-auth');
}

async function readPlain(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECRET_KEY, PLAIN);
    return isHex32(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function readAuthed(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECRET_KEY, AUTH);
    return isHex32(raw) ? raw : null;
  } catch (error) {
    throw authError(error);
  }
}

async function mark(value: '0' | '1'): Promise<void> {
  await SecureStore.setItemAsync(AUTH_KEY, value, PLAIN);
}

async function createDeviceSecret(): Promise<DeviceSecret> {
  const existing = await readPlain();
  if (existing) {
    await mark('0');
    return { hex: existing, authenticated: false };
  }
  const hex = toHex(await Crypto.getRandomBytesAsync(32));
  try {
    await SecureStore.setItemAsync(SECRET_KEY, hex, AUTH);
    await mark('1');
    const back = await readAuthed();
    if (back !== hex) throw new Error('device-auth');
    return { hex, authenticated: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'device-key-reset') throw error;
    const kept = await readPlain();
    if (kept) return { hex: kept, authenticated: false };
    try {
      const authed = await readAuthed();
      if (authed) return { hex: authed, authenticated: true };
    } catch (again) {
      throw again;
    }
    await SecureStore.setItemAsync(SECRET_KEY, hex, PLAIN);
    await mark('0');
    return { hex, authenticated: false };
  }
}

/** El mismo secreto en cada apertura. No sustituye uno que ya abre el PIN. */
export async function loadDeviceSecret(): Promise<DeviceSecret> {
  const flag = await SecureStore.getItemAsync(AUTH_KEY);
  if (flag === '1') {
    const hex = await readAuthed();
    if (!hex) throw new Error('device-key-reset');
    return { hex, authenticated: true };
  }
  if (flag === '0') {
    const hex = await readPlain();
    if (!hex) throw new Error('device-secret-lost');
    return { hex, authenticated: false };
  }
  const plain = await readPlain();
  if (plain) {
    await mark('0');
    await SecureStore.setItemAsync(REPAIR_KEY, '1', PLAIN);
    return { hex: plain, authenticated: false, repair: true };
  }
  try {
    const authed = await readAuthed();
    if (authed) {
      await mark('1');
      await SecureStore.setItemAsync(REPAIR_KEY, '1', PLAIN);
      return { hex: authed, authenticated: true, repair: true };
    }
  } catch (error) {
    throw error;
  }
  return createDeviceSecret();
}

/**
 * Solo al rehacer el PIN, después de la contraseña.
 * Si la llave del teléfono ya no se lee, ahí sí se crea otra.
 */
export async function ensureDeviceSecret(): Promise<DeviceSecret> {
  try {
    return await loadDeviceSecret();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message !== 'device-key-reset' && message !== 'device-secret-lost') throw error;
    await SecureStore.deleteItemAsync(SECRET_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(AUTH_KEY).catch(() => {});
    return createDeviceSecret();
  }
}

export async function phoneHasScreenLock(): Promise<boolean> {
  if (screenLockForTests) return screenLockForTests();
  try {
    const local = (await import('expo-local-authentication')) as {
      getEnrolledLevelAsync?: () => Promise<number>;
    };
    if (!local.getEnrolledLevelAsync) return false;
    const level = await local.getEnrolledLevelAsync();
    return Number(level) > 0;
  } catch {
    return false;
  }
}

/**
 * Reescribe el mismo secreto con el candado del teléfono.
 * Sin bloqueo de pantalla no lo intenta. Nunca genera otro secreto.
 */
export async function retryDeviceBinding(): Promise<'bound' | 'open' | 'no-lock' | 'lost'> {
  const flag = await SecureStore.getItemAsync(AUTH_KEY);
  if (flag === '1') return 'bound';
  if (!(await phoneHasScreenLock())) return 'no-lock';
  const hex = await readPlain();
  if (!hex) return 'lost';
  try {
    await SecureStore.setItemAsync(SECRET_KEY, hex, AUTH);
    const back = await readAuthed();
    if (back !== hex) return 'open';
    await mark('1');
    return 'bound';
  } catch {
    return 'open';
  }
}

export async function deviceNeedsNotice(): Promise<boolean> {
  return getProductMode() === 'live';
}

export async function readDeviceGuard(): Promise<DeviceGuard> {
  const repair = await SecureStore.getItemAsync(REPAIR_KEY).catch(() => null);
  try {
    const secret = await loadDeviceSecret();
    if (repair === '1' || secret.repair) return 'repair';
    return secret.authenticated ? 'bound' : 'open';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'device-key-reset') return 'reset';
    if (message === 'device-secret-lost') return 'lost';
    return 'confirm';
  }
}

/** La contraseña correcta cierra el aviso. El secreto que abre el PIN no cambia. */
export async function ackDeviceRepair(): Promise<void> {
  await SecureStore.deleteItemAsync(REPAIR_KEY).catch(() => {});
}
