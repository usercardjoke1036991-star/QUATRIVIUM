import * as SecureStore from 'expo-secure-store';
import { isValidUsername, normalizeUsername } from '../utils/usernamePolicy';
import { storeSlot } from '../utils/storeSlot';

/** Apodo local: se guarda solo en este teléfono, sin servidor ni reclamo único. */
const KEY = storeSlot(['quatrivium', 'account', 'username']);
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function loadClaimedUsername(): Promise<string> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const username = normalizeUsername(raw || '');
    return isValidUsername(username) ? username : '';
  } catch {
    return '';
  }
}

export async function saveClaimedUsername(username: string): Promise<string> {
  const next = normalizeUsername(username);
  if (!isValidUsername(next)) {
    throw new Error('username');
  }
  await SecureStore.setItemAsync(KEY, next, OPTIONS);
  return next;
}

/** Siempre disponible: no hay servidor que reserve apodos. */
export async function checkUsernameAvailable(
  _walletAddress: string,
  username: string
): Promise<boolean> {
  return isValidUsername(normalizeUsername(username));
}

/** Guarda el apodo localmente. Nunca bloquea el paso al hub ni los préstamos. */
export async function claimUsername(_walletAddress: string, username: string): Promise<string> {
  return saveClaimedUsername(username);
}

export async function clearClaimedUsername(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
}
