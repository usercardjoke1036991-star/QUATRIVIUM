import { DIRECT_COMMISSION_BPS, formatCommissionUSD, generationCommissionBps } from './commissions';
import { FAMA_PER_REFERRAL_L1 } from './fama';

/** Escala de fama de red. El directo (gen 1) no cobra fama: cobra 1 USDT. */
export const REFERRAL_REPUTATION_POINTS = FAMA_PER_REFERRAL_L1;
export const REFERRAL_NETWORK_POINTS = 0;
export const REFERRAL_BONUS_THRESHOLD = 250;
export const REFERRAL_POOL_BONUS_USD = 0;
const FOUNDER_FAME_BP = 1500;

export function generationBps(gen: number): number {
  return generationCommissionBps(gen);
}

/** Gen 1 = 0 fama. Resto = 100 × bps / 1500. */
export function fameForGeneration(gen: number): number {
  if (gen <= 1) return 0;
  return Math.floor((FAMA_PER_REFERRAL_L1 * generationBps(gen)) / DIRECT_COMMISSION_BPS);
}

export function founderFamePoints(): number {
  return Math.floor((FAMA_PER_REFERRAL_L1 * FOUNDER_FAME_BP) / DIRECT_COMMISSION_BPS);
}

export function referralsForNextBonus(
  _puntosRed: number,
  _umbral = REFERRAL_BONUS_THRESHOLD
): number {
  return 0;
}

export function formatPoolBonus(): string {
  return formatCommissionUSD(REFERRAL_POOL_BONUS_USD);
}
