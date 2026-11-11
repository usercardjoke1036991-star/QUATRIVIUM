import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { APP_DISPLAY_NAME } from '../constants/brand';
import { storeSlot } from './storeSlot';

const SECRET_KEY = storeSlot(['quatrivium', 'lock', 'deviceSecret']);
const AUTH_KEY = storeSlot(['quatrivium', 'lock', 'deviceAuth']);

const PLAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/**
 * Expo 54, SecureStore.requireAuthentication. No añade módulos nativos.
 * Android pide credencial en leer y en escribir. iOS la pide al leer.
 * Expo Go lo rechaza si hay biometría y falta NSFaceIDUsageDescription.
 * Sin PIN de pantalla, el llavero también lo rechaza.
 * En esos casos el secreto se guarda igual, pero sin el candado del sistema:
 * un volcado del llavero ya abierto podría leerlo. El PIN sigue sin bastar
 * si el atacante solo copió el registro del verificador.
 */
const AUTH = {
  ...PLAIN,
  requireAuthentication: true,
  authenticationPrompt: APP_DISPLAY_NAME,
};

export type DeviceSecret = { hex: string; authenticated: boolean };

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isHex32(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{64}$/.test(value));
}

async function readSecret(authenticated: boolean): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECRET_KEY, authenticated ? AUTH : PLAIN);
    return isHex32(raw) ? raw : null;
  } catch {
    if (authenticated) throw new Error('device-auth');
    return null;
  }
}

async function createDeviceSecret(): Promise<DeviceSecret> {
  const hex = toHex(await Crypto.getRandomBytesAsync(32));
  try {
    await SecureStore.setItemAsync(SECRET_KEY, hex, AUTH);
    await SecureStore.setItemAsync(AUTH_KEY, '1', PLAIN);
    const back = await SecureStore.getItemAsync(SECRET_KEY, AUTH);
    if (back !== hex) throw new Error('device-auth');
    return { hex, authenticated: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'device-auth') throw error;
    await SecureStore.setItemAsync(SECRET_KEY, hex, PLAIN);
    await SecureStore.setItemAsync(AUTH_KEY, '0', PLAIN);
    return { hex, authenticated: false };
  }
}

/** El mismo secreto en cada apertura. No se reemplaza si ya está escrito. */
export async function loadDeviceSecret(): Promise<DeviceSecret> {
  const flag = await SecureStore.getItemAsync(AUTH_KEY);
  if (flag === '1' || flag === '0') {
    const hex = await readSecret(flag === '1');
    if (!hex) throw new Error('device-auth');
    return { hex, authenticated: flag === '1' };
  }
  try {
    const plain = await SecureStore.getItemAsync(SECRET_KEY, PLAIN);
    if (isHex32(plain)) {
      await SecureStore.setItemAsync(AUTH_KEY, '0', PLAIN);
      return { hex: plain, authenticated: false };
    }
  } catch {
    // Puede estar guardado solo con requireAuthentication.
  }
  return createDeviceSecret();
}
