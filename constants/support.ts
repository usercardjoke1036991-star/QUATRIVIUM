export type SupportKind = 'none' | 'ally' | 'patron' | 'circle';

export const SUPPORT_PATRON_USD = 50;
export const SUPPORT_CIRCLE_USD = 200;
import { FAMA_PER_USDT } from './fama';

/** Contrato: 100 fama de caja por cada USDT donado o aportado al pool. */
export const FAME_PER_USDT_DONATE = FAMA_PER_USDT;
export const FAME_PER_USDT_POOL = FAMA_PER_USDT;

export function fameFromUsd(usd: number, pointsPerUsdt: number): number {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(pointsPerUsdt) || pointsPerUsdt <= 0) {
    return 0;
  }
  return Math.floor(usd * pointsPerUsdt);
}

export function fameFromDonateUsd(usd: number): number {
  return fameFromUsd(usd, FAME_PER_USDT_DONATE);
}

export function fameFromPoolUsd(usd: number): number {
  return fameFromUsd(usd, FAME_PER_USDT_POOL);
}

export function supportKind(donatedUsd: number, lpUsd: number): SupportKind {
  const donated = Number.isFinite(donatedUsd) ? Math.max(0, donatedUsd) : 0;
  const lp = Number.isFinite(lpUsd) ? Math.max(0, lpUsd) : 0;
  const total = donated + lp;
  if (total >= SUPPORT_CIRCLE_USD) return 'circle';
  if (total >= SUPPORT_PATRON_USD) return 'patron';
  if (total > 0) return 'ally';
  return 'none';
}

export function supportNameKey(
  kind: SupportKind
): 'supportAlly' | 'supportPatron' | 'supportCircle' | null {
  if (kind === 'ally') return 'supportAlly';
  if (kind === 'patron') return 'supportPatron';
  if (kind === 'circle') return 'supportCircle';
  return null;
}
