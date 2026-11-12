import AsyncStorage from '@react-native-async-storage/async-storage';
import { keccak256, toUtf8Bytes } from 'ethers';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { storeSlot } from '../utils/storeSlot';

const INSTALL_KEY = storeSlot(['quatrivium', 'device', 'installId']);
const INSTALL_FALLBACK = storeSlot(['quatrivium', 'device', 'installId', 'fallback']);
const BOUND_WALLET_KEY = storeSlot(['quatrivium', 'device', 'boundWallet']);
const BOUND_FALLBACK = storeSlot(['quatrivium', 'device', 'boundWallet', 'fallback']);
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function withLimit<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
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

export type DeviceClaim = { ok: true; wallet: string } | { ok: false; bound: string };

async function hardwareSeed(): Promise<string> {
  try {
    if (Platform.OS === 'android' && typeof Application.getAndroidId === 'function') {
      return String(Application.getAndroidId() || '');
    }
    if (Platform.OS === 'ios' && typeof Application.getIosIdForVendorAsync === 'function') {
      return (await Application.getIosIdForVendorAsync()) || '';
    }
  } catch {
    // ignore
  }
  return '';
}

async function installSeed(): Promise<string> {
  const existing =
    (await withLimit(
      SecureStore.getItemAsync(INSTALL_KEY).catch(() => null),
      1500,
      null
    )) || (await AsyncStorage.getItem(INSTALL_FALLBACK).catch(() => null));
  if (existing) return existing;
  const next = Crypto.randomUUID();
  await AsyncStorage.setItem(INSTALL_FALLBACK, next).catch(() => {});
  await withLimit(SecureStore.setItemAsync(INSTALL_KEY, next, OPTIONS), 2500, undefined);
  return next;
}

export async function getDeviceHash(): Promise<string> {
  const hardware = await hardwareSeed();
  const install = await installSeed();
  const seed = hardware || install;
  // La red o una VPN no entran en este hash. No crean otra cuenta.
  return keccak256(toUtf8Bytes(`quatrivium:${seed}`));
}

/** Error o tiempo agotado al leer el llavero. No es lo mismo que "no hay billetera". */
export const BOUND_UNKNOWN = 'desconocido';

export async function getBoundWallet(): Promise<string> {
  const secure = await withLimit(SecureStore.getItemAsync(BOUND_WALLET_KEY), 1500, BOUND_UNKNOWN);
  if (secure === BOUND_UNKNOWN) return BOUND_UNKNOWN;
  if (secure) return secure.toLowerCase();
  try {
    const fallback = await AsyncStorage.getItem(BOUND_FALLBACK);
    return (fallback || '').toLowerCase();
  } catch {
    return BOUND_UNKNOWN;
  }
}

export async function bindAppWallet(address: string): Promise<void> {
  const next = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(next)) return;
  await AsyncStorage.setItem(BOUND_FALLBACK, next).catch(() => {});
  await withLimit(SecureStore.setItemAsync(BOUND_WALLET_KEY, next, OPTIONS), 2500, undefined);
}

export async function clearBoundWallet(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BOUND_FALLBACK);
  } catch {
    // ignore
  }
  try {
    await SecureStore.deleteItemAsync(BOUND_WALLET_KEY);
  } catch {
    // ignore
  }
}

export async function claimDeviceWallet(address: string): Promise<DeviceClaim> {
  const next = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(next)) {
    return { ok: false, bound: '' };
  }
  const bound = await getBoundWallet();
  if (bound === BOUND_UNKNOWN) return { ok: false, bound: BOUND_UNKNOWN };
  if (!bound) {
    await bindAppWallet(next);
    return { ok: true, wallet: next };
  }
  if (bound === next) {
    return { ok: true, wallet: next };
  }
  return { ok: false, bound };
}
