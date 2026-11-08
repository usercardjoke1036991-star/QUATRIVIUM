import * as SecureStore from 'expo-secure-store';
import { clampLoanLevel } from '../constants/ranks';
import { storeSlot } from '../utils/storeSlot';

const PREFIX = storeSlot(['quatrivium', 'frame', 'equip']);
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const cache = new Map<string, number>();
const listeners = new Set<(wallet: string, level: number) => void>();

function slot(wallet: string): string {
  return `${PREFIX}.${String(wallet || '')
    .trim()
    .toLowerCase()}`;
}

function emit(wallet: string, level: number) {
  listeners.forEach((listener) => listener(wallet, level));
}

export function subscribeEquippedFrame(
  listener: (wallet: string, level: number) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function equippedFrameLevel(naturalLevel: number, equippedLevel = 0): number {
  const natural = clampLoanLevel(naturalLevel || 1);
  const equipped = Number(equippedLevel) || 0;
  if (equipped < 1) return natural;
  return clampLoanLevel(equipped);
}

export async function loadEquippedFrame(wallet: string): Promise<number> {
  const key = String(wallet || '')
    .trim()
    .toLowerCase();
  if (!key.startsWith('0x')) return 0;
  if (cache.has(key)) return cache.get(key) || 0;
  try {
    const raw = await SecureStore.getItemAsync(slot(key));
    const level = raw ? clampLoanLevel(Number(raw) || 0) : 0;
    cache.set(key, level);
    return level;
  } catch {
    return 0;
  }
}

export async function saveEquippedFrame(wallet: string, level: number): Promise<number> {
  const key = String(wallet || '')
    .trim()
    .toLowerCase();
  if (!key.startsWith('0x')) return 0;
  const next = clampLoanLevel(level);
  cache.set(key, next);
  await SecureStore.setItemAsync(slot(key), String(next), OPTIONS);
  emit(key, next);
  return next;
}
