import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { isAuthenticatorEnabled } from './authenticator';
import { getBiometricStatus, isBiometricEnabled, isPinSet } from './appLock';
import { storeSlot } from '../utils/storeSlot';

const KEY = storeSlot(['qc', 'auth', 'prefs', 'v2'], '_');
const LEGACY = 'qc_auth_prefs_v1';
const KEY_FALLBACK = 'qc_auth_prefs_v2.fallback';

export type AuthMethod = 'password' | 'email' | 'pin' | 'biometric' | 'authenticator';
export type AuthPurpose = 'signin' | 'unlock' | 'funds' | 'loanRequest' | 'loanPay';
export type AuthSlot = {
  on: boolean;
  methods: AuthMethod[];
  method: AuthMethod;
  primaryOnly: boolean;
};
export type AuthPrefs = Record<AuthPurpose, AuthSlot>;

export const AUTH_PURPOSES: AuthPurpose[] = ['signin', 'unlock', 'funds', 'loanRequest', 'loanPay'];
export const AUTH_METHODS: AuthMethod[] = [
  'password',
  'email',
  'pin',
  'biometric',
  'authenticator',
];
/** Pedir, pagar, transferir y desbloqueo: PIN, autenticador, huella y contraseña. Correo y teléfono no son candado. */
export const ACTION_AUTH_METHODS: AuthMethod[] = ['pin', 'authenticator', 'biometric', 'password'];

export function methodsForPurpose(
  purpose: AuthPurpose,
  _available: AuthMethod[] = []
): AuthMethod[] {
  if (purpose === 'signin') return ['password', 'pin', 'biometric', 'authenticator'];
  return [...ACTION_AUTH_METHODS];
}

const DEFAULTS: AuthPrefs = {
  signin: slot(false, ['password']),
  unlock: slot(true, ['password']),
  funds: slot(false, ['password']),
  loanRequest: slot(false, ['password']),
  loanPay: slot(false, ['password']),
};

function asMethod(value: unknown): AuthMethod {
  return AUTH_METHODS.includes(value as AuthMethod) ? (value as AuthMethod) : 'password';
}

function uniqueMethods(values: unknown): AuthMethod[] {
  const list = Array.isArray(values) ? values.map(asMethod) : [];
  return [...new Set(list)];
}

function slot(on: boolean, methods: AuthMethod[], primaryOnly = true): AuthSlot {
  const next = uniqueMethods(methods).filter((method) => ACTION_AUTH_METHODS.includes(method));
  if (!on) {
    return { on: false, methods: next, method: next[0] || 'password', primaryOnly };
  }
  const list: AuthMethod[] = next.length ? next : ['password'];
  return { on: true, methods: list, method: list[0], primaryOnly: list.length <= 1 };
}

function asSlot(value: unknown, fallbackOn: boolean): AuthSlot {
  if (value && typeof value === 'object') {
    const raw = value as {
      on?: boolean;
      method?: AuthMethod;
      methods?: AuthMethod[];
      primaryOnly?: boolean;
    };
    const fromList = uniqueMethods(raw.methods);
    const fromOne = raw.method ? [asMethod(raw.method)] : [];
    return slot(Boolean(raw.on), fromList.length ? fromList : fromOne, raw.primaryOnly !== false);
  }
  if (typeof value === 'string') return slot(fallbackOn, [asMethod(value)]);
  return slot(fallbackOn, ['password']);
}

function normalize(raw: Partial<AuthPrefs> | Record<string, unknown>): AuthPrefs {
  const legacy = raw as Partial<Record<AuthPurpose, AuthMethod | AuthSlot>>;
  return {
    signin: asSlot(legacy.signin, false),
    unlock: asSlot(legacy.unlock, true),
    funds: asSlot(legacy.funds, false),
    loanRequest: asSlot(legacy.loanRequest, false),
    loanPay: asSlot(legacy.loanPay, false),
  };
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

async function readRaw(): Promise<AuthPrefs> {
  try {
    const fallback = await AsyncStorage.getItem(KEY_FALLBACK).catch(() => null);
    const secure = fallback
      ? null
      : await withTimeout(
          SecureStore.getItemAsync(KEY).catch(() => null),
          12000,
          null
        );
    const raw = fallback || secure;
    if (raw) return normalize(JSON.parse(raw) as Partial<AuthPrefs>);
    const legacy = await withTimeout(
      SecureStore.getItemAsync(LEGACY).catch(() => null),
      4000,
      null
    );
    if (legacy) return normalize(JSON.parse(legacy) as Record<string, unknown>);
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function getAvailableMethods(): Promise<AuthMethod[]> {
  const methods: AuthMethod[] = ['password'];
  if (await isPinSet()) methods.push('pin');
  if (await isMethodReady('biometric')) methods.push('biometric');
  if (await isAuthenticatorEnabled()) methods.push('authenticator');
  return methods;
}

export async function isMethodReady(method: AuthMethod): Promise<boolean> {
  if (method === 'password') return true;
  if (method === 'email') return false;
  if (method === 'pin') return isPinSet();
  if (method === 'biometric') {
    if (!(await isBiometricEnabled())) return false;
    return (await getBiometricStatus()).available;
  }
  return isAuthenticatorEnabled();
}

async function sanitize(prefs: AuthPrefs): Promise<AuthPrefs> {
  const next = { ...prefs };
  for (const purpose of AUTH_PURPOSES) {
    const allowed = methodsForPurpose(purpose);
    const chosen = next[purpose].methods.filter((method) => allowed.includes(method));
    const on = Boolean(next[purpose].on) && chosen.length > 0;
    next[purpose] = slot(on, chosen, chosen.length <= 1);
  }
  return next;
}

async function persist(prefs: AuthPrefs): Promise<void> {
  const payload = JSON.stringify(prefs);
  await AsyncStorage.setItem(KEY_FALLBACK, payload).catch(() => {});
  await withTimeout(SecureStore.setItemAsync(KEY, payload), 2500, undefined);
}

export async function loadAuthPrefs(): Promise<AuthPrefs> {
  const raw = await readRaw();
  const next = await sanitize(raw);
  if (JSON.stringify(raw) !== JSON.stringify(next)) {
    await persist(next);
  }
  return next;
}

export async function saveAuthPrefs(prefs: AuthPrefs): Promise<AuthPrefs> {
  const next = await sanitize(prefs);
  await persist(next);
  const session = await import('./savedSession');
  if (next.unlock.on) {
    await session.purgePersistedWrap();
  } else {
    await session.markSessionSaved();
  }
  return next;
}

export async function getAuthMethods(purpose: AuthPurpose): Promise<AuthMethod[]> {
  const prefs = await loadAuthPrefs();
  return prefs[purpose].methods;
}

export async function getAuthMethod(purpose: AuthPurpose): Promise<AuthMethod> {
  const methods = await getAuthMethods(purpose);
  return methods[0] || 'password';
}

export async function isAuthEnabled(purpose: AuthPurpose): Promise<boolean> {
  const prefs = await loadAuthPrefs();
  return prefs[purpose].on;
}

/** El interruptor de Cómo confirma decide si el desbloqueo pide clave. */
export async function ensureUnlockEnabled(): Promise<void> {
  return;
}

export async function setAuthMethod(purpose: AuthPurpose, method: AuthMethod): Promise<void> {
  if (!(await isMethodReady(method))) {
    throw new Error('method_not_ready');
  }
  const prefs = await readRaw();
  prefs[purpose] = slot(prefs[purpose].on, [method], prefs[purpose].primaryOnly !== false);
  await persist(await sanitize(prefs));
}

export async function setAuthMethods(purpose: AuthPurpose, methods: AuthMethod[]): Promise<void> {
  const prefs = await readRaw();
  prefs[purpose] = slot(true, methods, prefs[purpose].primaryOnly !== false);
  await persist(await sanitize(prefs));
}

export async function fallbackAuthIfNeeded(removed: AuthMethod): Promise<void> {
  const prefs = await readRaw();
  let changed = false;
  for (const purpose of AUTH_PURPOSES) {
    if (!prefs[purpose].methods.includes(removed)) continue;
    const next = prefs[purpose].methods.filter((item) => item !== removed);
    prefs[purpose] = slot(prefs[purpose].on, next, prefs[purpose].primaryOnly !== false);
    changed = true;
  }
  if (changed) await persist(await sanitize(prefs));
}
