import AsyncStorage from '@react-native-async-storage/async-storage';
import { storeSlot } from './storeSlot';

const PAIRS: [string, string][] = [
  ['bitcredit.lang', storeSlot(['quatrivium', 'lang'])],
  ['bitcredit.theme', storeSlot(['quatrivium', 'theme'])],
  ['bitcredit.invite', storeSlot(['quatrivium', 'invite'])],
  ['bitcredit.notify.profile', storeSlot(['quatrivium', 'notify', 'profile'])],
  ['bitcredit.profile.own', storeSlot(['quatrivium', 'profile', 'own'])],
  ['bitcredit.profile.directory', storeSlot(['quatrivium', 'profile', 'directory'])],
];

/** Restos de la sesión de billetera externa que la app ya no usa. Ninguna casilla propia empieza así. */
export const OLD_WALLET_SESSION_PREFIXES = ['appkit:', 'wc@2:'] as const;

/** Borra solo esas casillas. Si AsyncStorage falla, no hace nada y lo intenta en el próximo arranque. */
export async function dropOldWalletSession(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((key) =>
      OLD_WALLET_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
    if (stale.length) await AsyncStorage.multiRemove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}

export async function migrateLegacyStorage(): Promise<void> {
  await dropOldWalletSession();
  for (const [from, to] of PAIRS) {
    try {
      const next = await AsyncStorage.getItem(to);
      if (next) continue;
      const prev = await AsyncStorage.getItem(from);
      if (!prev) continue;
      await AsyncStorage.setItem(to, prev);
      await AsyncStorage.removeItem(from);
    } catch {
      // ignore
    }
  }
}
