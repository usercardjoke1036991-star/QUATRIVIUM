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

export async function migrateLegacyStorage(): Promise<void> {
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
