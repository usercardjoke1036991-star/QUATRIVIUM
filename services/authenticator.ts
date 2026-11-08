import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { deriveWrapKeyAsync, isSealedBlob, openSecret, sealSecret } from '../utils/secretBox';
import { bytesToBase32, otpauthUrl, verifyTotp } from '../utils/totp';
import { getWalletWrapKey, setWalletWrapKey } from './walletSession';

const KEY = 'qc_totp_secret_v1';
const WRAP_KEY = 'qc_totp_wrap_v1';
const WRAP_SALT = 'qc.totp.wrap';
const WRAP_ROUNDS = 8000;
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function isAuthenticatorEnabled(): Promise<boolean> {
  try {
    const secret = await SecureStore.getItemAsync(KEY);
    return Boolean(secret);
  } catch {
    return false;
  }
}

export async function loadAuthenticatorSecret(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function createAuthenticatorSecret(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(20);
  return bytesToBase32(bytes);
}

export function authenticatorUri(secret: string, account: string): string {
  return otpauthUrl(secret, account);
}

export async function persistAuthenticatorWrap(wrap = getWalletWrapKey()): Promise<boolean> {
  const secret = await loadAuthenticatorSecret();
  if (!wrap || !secret) return false;
  try {
    const key = await deriveWrapKeyAsync(secret, WRAP_SALT, WRAP_ROUNDS);
    await SecureStore.setItemAsync(WRAP_KEY, sealSecret(wrap, key), OPTIONS);
    return true;
  } catch {
    return false;
  }
}

export async function confirmAuthenticator(secret: string, code: string): Promise<boolean> {
  if (!verifyTotp(secret, code)) return false;
  await SecureStore.setItemAsync(KEY, secret, OPTIONS);
  await persistAuthenticatorWrap();
  return true;
}

export async function verifyAuthenticator(code: string): Promise<boolean> {
  const secret = await loadAuthenticatorSecret();
  if (!secret) return false;
  return verifyTotp(secret, code);
}

export async function unlockWithAuthenticator(code: string): Promise<boolean> {
  const secret = await loadAuthenticatorSecret();
  if (!secret || !verifyTotp(secret, code)) return false;
  try {
    const raw = await SecureStore.getItemAsync(WRAP_KEY);
    if (!raw || !isSealedBlob(raw)) return false;
    const key = await deriveWrapKeyAsync(secret, WRAP_SALT, WRAP_ROUNDS);
    setWalletWrapKey(openSecret(raw, key));
    return Boolean(getWalletWrapKey());
  } catch {
    return false;
  }
}

export async function clearAuthenticator(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
  try {
    await SecureStore.deleteItemAsync(WRAP_KEY);
  } catch {
    /* ignore */
  }
}
