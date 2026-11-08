/** Racha diaria: un referido que pide y paga suma un día. */

export const FAMA_POR_DIA_RACHA = 100;
export const RACHA_GRACIA_DIAS = 1;
export const RACHA_HITOS = [7, 30, 100, 365] as const;
export const RACHA_BONO_USDT = [5, 25, 100, 500] as const;

export function rachaBonusUsd(days: number): number {
  const index = RACHA_HITOS.indexOf(days as (typeof RACHA_HITOS)[number]);
  if (index < 0) return 0;
  return RACHA_BONO_USDT[index];
}

export function nextRachaHito(claimed: number): number {
  if (claimed < 7) return 7;
  if (claimed < 30) return 30;
  if (claimed < 100) return 100;
  if (claimed < 365) return 365;
  return 0;
}
