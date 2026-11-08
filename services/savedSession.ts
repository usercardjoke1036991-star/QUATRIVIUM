import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { ensureUnlockEnabled, isAuthEnabled } from './authPrefs';
import { clearWalletSession, getWalletWrapKey, setWalletWrapKey } from './walletSession';

type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

export function subscribeSessionCleared(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

const FLAG = 'qc_session_saved_v1';
const WRAP = 'qc_session_wrap_v1';
const FLAG_FALLBACK = 'qc_session_saved_fallback_v1';
const WRAP_FALLBACK = 'qc_session_wrap_fallback_v1';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

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

export async function isSessionSaved(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(FLAG_FALLBACK)) === '1') return true;
  } catch {
    // ignore
  }
  return withTimeout(
    SecureStore.getItemAsync(FLAG)
      .then((value) => value === '1')
      .catch(() => false),
    12000,
    false
  );
}

export async function purgePersistedWrap(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WRAP_FALLBACK);
  } catch {
    // ignore
  }
  await withTimeout(
    SecureStore.deleteItemAsync(WRAP).catch(() => undefined),
    1500,
    undefined
  );
}

export async function markSessionSaved(): Promise<void> {
  await AsyncStorage.setItem(FLAG_FALLBACK, '1').catch(() => {});
  await withTimeout(SecureStore.setItemAsync(FLAG, '1', OPTIONS), 2000, undefined);
  await withTimeout(
    ensureUnlockEnabled().catch(() => undefined),
    2000,
    undefined
  );
  const wrap = getWalletWrapKey();
  const unlockOn = await withTimeout(
    isAuthEnabled('unlock').catch(() => false),
    1500,
    false
  );
  // Si el desbloqueo está on, la wrap se deriva al desbloquear. Nunca en AsyncStorage.
  if (wrap && !unlockOn) {
    await withTimeout(SecureStore.setItemAsync(WRAP, wrap, OPTIONS), 2000, undefined);
    await AsyncStorage.removeItem(WRAP_FALLBACK).catch(() => {});
    return;
  }
  await purgePersistedWrap();
}

export async function restoreSavedSessionWrap(): Promise<boolean> {
  try {
    const leaked = await AsyncStorage.getItem(WRAP_FALLBACK).catch(() => null);
    let raw = leaked;
    if (!raw) {
      raw = await withTimeout(
        SecureStore.getItemAsync(WRAP).catch(() => null),
        12000,
        null
      );
    }
    if (__DEV__) {
      console.log('[boot] wrap restore', {
        migrated: Boolean(leaked),
        fromSecure: Boolean(raw && !leaked),
      });
    }
    if (!raw) return false;
    setWalletWrapKey(raw);
    await withTimeout(SecureStore.setItemAsync(WRAP, raw, OPTIONS), 2000, undefined);
    if (leaked) {
      await AsyncStorage.removeItem(WRAP_FALLBACK).catch(() => {});
    }
    return Boolean(getWalletWrapKey());
  } catch {
    return false;
  }
}

export async function clearSavedSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FLAG_FALLBACK);
  } catch {
    // ignore
  }
  try {
    await AsyncStorage.removeItem(WRAP_FALLBACK);
  } catch {
    // ignore
  }
  await withTimeout(
    SecureStore.deleteItemAsync(FLAG).catch(() => undefined),
    1500,
    undefined
  );
  await withTimeout(
    SecureStore.deleteItemAsync(WRAP).catch(() => undefined),
    1500,
    undefined
  );
}

export async function signOutSavedSession(): Promise<void> {
  clearWalletSession();
  await clearSavedSession();
  sessionListeners.forEach((listener) => listener());
}
