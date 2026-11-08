/** Reserva: bloqueo 30 días, techo 12% anual. No es el pool de préstamos. */

export const RESERVA_LOCK_SECONDS = 30 * 24 * 60 * 60;
export const RESERVA_MAX_APY_BP = 1200;
export const RESERVA_YEAR_SECONDS = 365 * 24 * 60 * 60;
export const RESERVA_TRAMO_MEDIO = 50;
export const RESERVA_TRAMO_ALTO = 500;
export const RESERVA_MIN_LEVEL = 10;
export const RESERVA_MIN_LOCK_USDT = 1;
export const RESERVA_MIN_LOCK_WEI = 10n ** 18n;
export const RESERVA_LOCK_BUTTONS = [1, 10, 25, 50, 100, 250, 500, 1000] as const;

export function reservaTramoUsd(principalUsd: number): 1 | 2 | 3 {
  if (principalUsd >= RESERVA_TRAMO_ALTO) return 3;
  if (principalUsd >= RESERVA_TRAMO_MEDIO) return 2;
  return 1;
}

export function reservaBoostRedBp(tramo: 1 | 2 | 3): number {
  if (tramo === 3) return 2000;
  if (tramo === 2) return 1000;
  return 0;
}

export function reservaCorteFundadorBp(tramo: 1 | 2 | 3): number {
  if (tramo === 3) return 1200;
  if (tramo === 2) return 800;
  return 500;
}

/** Extra de comisión desde el pool: % del tramo sobre la comisión, tope % del principal. */
export function reservaExtraComisionWei(
  montoBaseWei: bigint,
  principalWei: bigint,
  yaPagadoWei = 0n
): { extra: bigint; founderCut: bigint; userPay: bigint } {
  const usd = Number(principalWei / 10n ** 18n);
  const tramo = reservaTramoUsd(Number.isFinite(usd) ? usd : 0);
  const boostBp = BigInt(reservaBoostRedBp(tramo));
  let extra = (montoBaseWei * boostBp) / 10000n;
  const tope = (principalWei * boostBp) / 10000n;
  if (yaPagadoWei >= tope) {
    return { extra: 0n, founderCut: 0n, userPay: 0n };
  }
  const room = tope - yaPagadoWei;
  if (extra > room) extra = room;
  const founderCut = (extra * BigInt(reservaCorteFundadorBp(tramo))) / 10000n;
  return { extra, founderCut, userPay: extra - founderCut };
}

export function reservaTechoWei(principalWei: bigint, elapsedSec: number): bigint {
  const elapsed = BigInt(Math.min(Math.max(0, Math.floor(elapsedSec)), RESERVA_LOCK_SECONDS));
  return (
    (principalWei * BigInt(RESERVA_MAX_APY_BP) * elapsed) / (10000n * BigInt(RESERVA_YEAR_SECONDS))
  );
}
