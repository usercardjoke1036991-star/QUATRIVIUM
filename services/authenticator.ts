import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { peekDeviceSecret, readDeviceGuard } from '../utils/deviceSecret';
import { deriveWrapKeyAsync, isSealedBlob, openSecret, sealSecret } from '../utils/secretBox';
import { bytesToBase32, matchingTotpStep, otpauthUrl, verifyTotp } from '../utils/totp';
import {
  anchorLockAttempt,
  clearLockAfterSuccess,
  reserveAttempt,
  totpUnlockBlocked,
  withLockVerify,
  type PinCheck,
} from './appLock';
import { getWalletWrapKey, setWalletWrapKey } from './walletSession';

const KEY = 'qc_totp_secret_v1';
const WRAP_KEY = 'qc_totp_wrap_v1';
const STEP_KEY = 'qc_totp_step_v1';
const MIG_KEY = 'qc_totp_wrap_mig_v1';
const STEP_MONO_KEY = 'qc_totp_step_mono_v1';
const WRAP_SALT = 'qc.totp.wrap';
const WRAP_ROUNDS = 8000;
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const BUSY: PinCheck = { ok: false, remainingMs: 0, locked: false, busy: true };

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** HKDF del secreto TOTP con el secreto del teléfono. El TOTP solo no abre la llave. */
export function totpDeviceWrapKey(secret: string, deviceHex: string): string {
  const out = hkdf(
    sha256,
    utf8(`${secret}:${deviceHex}`),
    utf8('quatrivium-totp'),
    utf8('quatrivium-totp-wrap'),
    32
  );
  return `0x${toHex(out)}`;
}

function timedRead<T>(promise: Promise<T>, ms = 1500): Promise<T | 'unknown'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('unknown'), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve('unknown');
      }
    );
  });
}

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
  const deviceHex = await peekDeviceSecret();
  if (!wrap || !secret) return false;
  if (!deviceHex) {
    await SecureStore.deleteItemAsync(WRAP_KEY).catch(() => {});
    await SecureStore.deleteItemAsync(MIG_KEY).catch(() => {});
    return false;
  }
  try {
    const key = totpDeviceWrapKey(secret, deviceHex);
    await SecureStore.setItemAsync(WRAP_KEY, sealSecret(wrap, key), OPTIONS);
    await SecureStore.setItemAsync(MIG_KEY, '1', OPTIONS);
    const back = await SecureStore.getItemAsync(MIG_KEY);
    return back === '1';
  } catch {
    return false;
  }
}

export async function confirmAuthenticator(secret: string, code: string): Promise<boolean> {
  if (!verifyTotp(secret, code)) return false;
  await SecureStore.deleteItemAsync(STEP_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(STEP_MONO_KEY).catch(() => {});
  await SecureStore.setItemAsync(KEY, secret, OPTIONS);
  await persistAuthenticatorWrap();
  return true;
}

async function readLastStep(): Promise<{ step: number; mono: number } | 'unknown'> {
  const raw = await timedRead(SecureStore.getItemAsync(STEP_KEY));
  if (raw === 'unknown') return 'unknown';
  if (!raw) return { step: 0, mono: 0 };
  const step = Number(raw);
  if (!Number.isFinite(step) || step < 0) return 'unknown';
  const monoRaw = await timedRead(SecureStore.getItemAsync(STEP_MONO_KEY));
  if (monoRaw === 'unknown') return 'unknown';
  const mono = monoRaw ? Number(monoRaw) : 0;
  if (!Number.isFinite(mono) || mono < 0) return 'unknown';
  return { step, mono };
}

async function confirmStep(step: number, mono: number): Promise<boolean> {
  const text = String(step);
  const wrote = await timedRead(SecureStore.setItemAsync(STEP_KEY, text, OPTIONS));
  if (wrote === 'unknown') return false;
  const monoText = String(mono);
  const monoWrote = await timedRead(SecureStore.setItemAsync(STEP_MONO_KEY, monoText, OPTIONS));
  if (monoWrote === 'unknown') return false;
  const back = await timedRead(SecureStore.getItemAsync(STEP_KEY));
  const monoBack = await timedRead(SecureStore.getItemAsync(STEP_MONO_KEY));
  return back === text && monoBack === monoText;
}

function stepTooFarAhead(step: number, last: { step: number; mono: number }, monoNow: number): boolean {
  if (!(last.step > 0) || !(last.mono > 0)) return false;
  const elapsed = Math.max(0, monoNow - last.mono);
  const allowed = last.step + 1 + Math.floor(elapsed / 30_000);
  return step > allowed;
}

async function acceptCode(
  code: string,
  secret: string
): Promise<PinCheck | { step: number; fails: number }> {
  const reserved = await reserveAttempt('totp');
  if (reserved.status === 'unknown') {
    return { ok: false, remainingMs: 0, locked: false, storeUnknown: true };
  }
  if (reserved.status === 'wait') {
    return { ok: false, remainingMs: reserved.remainingMs, locked: true };
  }
  if (reserved.status === 'pin-blocked') {
    return { ok: false, remainingMs: 0, locked: true, pinBlocked: true };
  }
  if (reserved.status === 'totp-blocked') {
    return { ok: false, remainingMs: 0, locked: true, totpBlocked: true };
  }
  const step = matchingTotpStep(secret, code);
  const last = await readLastStep();
  const mono = performance.now();
  if (
    step == null ||
    last === 'unknown' ||
    step <= last.step ||
    stepTooFarAhead(step, last, mono)
  ) {
    anchorLockAttempt(reserved.fails);
    return { ok: false, remainingMs: reserved.left, locked: reserved.left > 0 };
  }
  if (!(await confirmStep(step, mono))) {
    anchorLockAttempt(reserved.fails);
    return { ok: false, remainingMs: reserved.left, locked: reserved.left > 0 };
  }
  return { step, fails: reserved.fails };
}

async function openTotpWrap(secret: string, deviceHex: string): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(WRAP_KEY);
  if (!raw || !isSealedBlob(raw)) return false;
  const migrated = await SecureStore.getItemAsync(MIG_KEY).catch(() => null);
  const nextKey = totpDeviceWrapKey(secret, deviceHex);
  try {
    setWalletWrapKey(openSecret(raw, nextKey));
    if (migrated !== '1') {
      await SecureStore.setItemAsync(MIG_KEY, '1', OPTIONS);
    }
    return Boolean(getWalletWrapKey());
  } catch {
    if (migrated === '1') return false;
  }
  try {
    const legacy = await deriveWrapKeyAsync(secret, WRAP_SALT, WRAP_ROUNDS);
    const opened = openSecret(raw, legacy);
    const resealed = sealSecret(opened, nextKey);
    await SecureStore.setItemAsync(WRAP_KEY, resealed, OPTIONS);
    const back = await SecureStore.getItemAsync(WRAP_KEY);
    if (back !== resealed) return false;
    await SecureStore.setItemAsync(MIG_KEY, '1', OPTIONS);
    const mig = await SecureStore.getItemAsync(MIG_KEY);
    if (mig !== '1') return false;
    setWalletWrapKey(opened);
    return Boolean(getWalletWrapKey());
  } catch {
    return false;
  }
}

export async function verifyAuthenticator(code: string): Promise<PinCheck> {
  try {
    return await withLockVerify(async () => {
      const secret = await loadAuthenticatorSecret();
      if (!secret) return { ok: false, remainingMs: 0, locked: false };
      await peekDeviceSecret();
      const accepted = await acceptCode(code, secret);
      if (!('step' in accepted)) return accepted;
      await clearLockAfterSuccess();
      return { ok: true };
    }, BUSY);
  } catch (error) {
    if (error instanceof Error && error.message === 'lock-verify-timeout') {
      return { ok: false, remainingMs: 0, locked: false };
    }
    throw error;
  }
}

export async function unlockWithAuthenticator(code: string): Promise<PinCheck> {
  try {
    return await withLockVerify(async () => {
      if (await totpUnlockBlocked()) {
        return { ok: false, remainingMs: 0, locked: true, totpBlocked: true };
      }
      const secret = await loadAuthenticatorSecret();
      if (!secret) return { ok: false, remainingMs: 0, locked: false };
      const deviceHex = await peekDeviceSecret();
      if (!deviceHex) {
        await SecureStore.deleteItemAsync(WRAP_KEY).catch(() => {});
        await SecureStore.deleteItemAsync(MIG_KEY).catch(() => {});
      }
      const accepted = await acceptCode(code, secret);
      if (!('step' in accepted)) {
        if ('totpBlocked' in accepted && accepted.totpBlocked) return accepted;
        return accepted;
      }
      const guard = await readDeviceGuard();
      if (guard !== 'bound' || !deviceHex) {
        anchorLockAttempt(accepted.fails);
        return { ok: false, remainingMs: 0, locked: false };
      }
      if (!(await openTotpWrap(secret, deviceHex))) {
        anchorLockAttempt(accepted.fails);
        return { ok: false, remainingMs: 0, locked: false };
      }
      await clearLockAfterSuccess();
      return { ok: true };
    }, BUSY);
  } catch (error) {
    if (error instanceof Error && error.message === 'lock-verify-timeout') {
      return { ok: false, remainingMs: 0, locked: false };
    }
    throw error;
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
  try {
    await SecureStore.deleteItemAsync(STEP_KEY);
  } catch {
    /* ignore */
  }
  try {
    await SecureStore.deleteItemAsync(STEP_MONO_KEY);
  } catch {
    /* ignore */
  }
  try {
    await SecureStore.deleteItemAsync(MIG_KEY);
  } catch {
    /* ignore */
  }
}
