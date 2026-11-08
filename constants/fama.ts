/** Fama de caja: donar o aportar al pool (no la puerta de 2+1), racha y red gen 2+. */

export const FAMA_PER_USDT = 100;
/** Escala de fama de red (gen 1 no cobra: cobra el 1 USDT). */
export const FAMA_PER_REFERRAL_L1 = 100;
/** 250 fama disponible = 1 USDT de canje. Siempre menor que lo metido. */
export const FAMA_CANJE_POR_USDT = 250;
export const CANJE_USDT_BUTTONS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const;

export function famaFromUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.floor(usd * FAMA_PER_USDT);
}

export function famaNeededForUsdt(usdt: number): number {
  if (!Number.isFinite(usdt) || usdt <= 0) return 0;
  return Math.floor(usdt) * FAMA_CANJE_POR_USDT;
}

export function usdtFromFama(fama: number): number {
  if (!Number.isFinite(fama) || fama < FAMA_CANJE_POR_USDT) return 0;
  return Math.floor(fama / FAMA_CANJE_POR_USDT);
}

export function maxCanjeUsdt(famaDisponible: number): number {
  return usdtFromFama(famaDisponible);
}
