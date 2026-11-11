import type { TranslationKey } from '../i18n/translations';

type Vars = Record<string, string | number>;

export type LockMiss = {
  ok: false;
  remainingMs: number;
  locked: boolean;
  pinBlocked?: boolean;
  deviceAuth?: boolean;
};

type Copy = { key: TranslationKey; vars?: Vars };

/** Espera real. Cero milisegundos no se anuncia como "espere 0 s". */
export function lockWaitCopy(remainingMs: number): Copy | null {
  const wait = Math.max(0, Math.floor(remainingMs));
  if (wait <= 0) return null;
  if (wait >= 60_000) {
    return { key: 'lockCooldownMinutes', vars: { minutes: Math.ceil(wait / 60_000) } };
  }
  return { key: 'lockCooldown', vars: { seconds: Math.ceil(wait / 1000) } };
}

/**
 * Texto del fallo de PIN o contraseña.
 * PIN bloqueado, espera y fallo al leer el teléfono no se disfrazan de PIN incorrecto.
 */
export function lockFailureCopy(
  method: 'pin' | 'password',
  checked: LockMiss,
  passwordMissing = false
): Copy {
  if (checked.pinBlocked) return { key: 'lockPinBlocked' };
  if (checked.deviceAuth) return { key: 'lockDeviceAuth' };
  const wait = lockWaitCopy(checked.remainingMs);
  if (checked.locked && wait) return wait;
  if (checked.locked) return { key: 'lockPinBlocked' };
  if (method === 'password' && passwordMissing) return { key: 'signInNoAccount' };
  return { key: method === 'pin' ? 'lockPinWrong' : 'lockPasswordWrong' };
}

/** Lo que muestran FundsConfirmHost y el candado. */
export function describeLockFailure(
  method: 'pin' | 'password',
  checked: LockMiss,
  t: (key: TranslationKey, vars?: Vars) => string,
  passwordMissing = false
): string {
  const copy = lockFailureCopy(method, checked, passwordMissing);
  return t(copy.key, copy.vars);
}
