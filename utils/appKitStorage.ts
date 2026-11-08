import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Storage } from '@reown/appkit-react-native';

const PREFIX = 'appkit:';

function namespaced(key: string): string {
  return key.startsWith(PREFIX) ? key : `${PREFIX}${key}`;
}

function stripPrefix(key: string): string {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
}

function parseJson<T>(value: string | null): T | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export const appKitStorage: Storage = {
  getKeys: async () => {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((key) => key.startsWith(PREFIX)).map(stripPrefix);
  },
  getEntries: async <T = unknown>(): Promise<[string, T][]> => {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
    if (keys.length === 0) {
      return [];
    }
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.map(([key, value]) => [stripPrefix(key), parseJson<T>(value) as T]);
  },
  setItem: async <T = unknown>(key: string, value: T) => {
    await AsyncStorage.setItem(namespaced(key), JSON.stringify(value));
  },
  getItem: async <T = unknown>(key: string): Promise<T | undefined> => {
    const item = await AsyncStorage.getItem(namespaced(key));
    return parseJson<T>(item);
  },
  removeItem: async (key: string) => {
    await AsyncStorage.removeItem(namespaced(key));
  },
};
