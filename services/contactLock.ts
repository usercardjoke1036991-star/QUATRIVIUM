import AsyncStorage from '@react-native-async-storage/async-storage';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export type ContactKind = 'email' | 'phone';

function storageKey(wallet: string, kind: ContactKind): string {
  return `qv.contact.lock.${kind}.${wallet.trim().toLowerCase()}`;
}

export function contactStillLocked(until: number, now = Date.now()): boolean {
  return Number.isFinite(until) && until > now;
}

export async function readContactLock(wallet: string, kind: ContactKind): Promise<number> {
  if (!wallet) return 0;
  try {
    const raw = await AsyncStorage.getItem(storageKey(wallet, kind));
    const until = Number(raw || 0);
    return Number.isFinite(until) && until > 0 ? until : 0;
  } catch {
    return 0;
  }
}

/** Cada guardado correcto empieza un mes nuevo. Sin billetera no hay candado. */
export async function stampContactLock(
  wallet: string,
  kind: ContactKind,
  at = Date.now()
): Promise<number> {
  if (!wallet) return 0;
  const until = at + MONTH_MS;
  try {
    await AsyncStorage.setItem(storageKey(wallet, kind), String(until));
  } catch {
    // La pantalla sigue bloqueando el cambio en esta sesión.
  }
  return until;
}

/** Si el dato ya está guardado y no hay fecha, el mes empieza ahora. */
export async function ensureContactLock(
  wallet: string,
  kind: ContactKind,
  present: boolean
): Promise<number> {
  if (!wallet || !present) return 0;
  const current = await readContactLock(wallet, kind);
  if (current > 0) return current;
  return stampContactLock(wallet, kind);
}
