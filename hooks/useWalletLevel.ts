import { useEffect, useState } from 'react';
import { clampLoanLevel } from '../constants/ranks';
import { QuatriviumCreditService } from '../services/quatriviumCreditService';

const cache = new Map<string, { level: number; at: number }>();
const TTL_MS = 45_000;

export async function getWalletLevel(wallet?: string): Promise<number> {
  const key = String(wallet || '').toLowerCase();
  if (!key.startsWith('0x')) return 1;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.level;
  try {
    const progress = await QuatriviumCreditService.obtenerProgresoUsuario(key);
    const level = clampLoanLevel(Number(progress.nivelActual) || 1);
    cache.set(key, { level, at: Date.now() });
    return level;
  } catch {
    return hit?.level || 1;
  }
}

export function rememberWalletLevel(wallet: string, level: number) {
  const key = wallet.toLowerCase();
  cache.set(key, { level: clampLoanLevel(level), at: Date.now() });
}

export function useWalletLevel(wallet?: string, knownLevel?: number) {
  const [level, setLevel] = useState(() => {
    if (knownLevel && knownLevel > 0) return clampLoanLevel(knownLevel);
    const key = String(wallet || '').toLowerCase();
    return cache.get(key)?.level || 1;
  });

  useEffect(() => {
    if (knownLevel && knownLevel > 0) {
      const next = clampLoanLevel(knownLevel);
      setLevel(next);
      if (wallet) rememberWalletLevel(wallet, next);
      return;
    }
    let cancelled = false;
    void getWalletLevel(wallet)
      .then((next) => {
        if (!cancelled) setLevel(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet, knownLevel]);

  return level;
}
