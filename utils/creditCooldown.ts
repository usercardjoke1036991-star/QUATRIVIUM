/** Igual que `QuatriviumCredit.COOLDOWN_PRESTAMO` (48 hours). */
export const PRESTAMO_COOLDOWN_SECS = 48 * 60 * 60;

/**
 * Countdown local. `obtenerCooldownRestante` cambia cada segundo y
 * FallbackProvider exige quorum de resultados idénticos entre RPC.
 */
export function cooldownRestanteDesdeTimestamp(
  ultimoPrestamoTimestamp: number,
  nowSec: number = Math.floor(Date.now() / 1000)
): number {
  if (!Number.isFinite(ultimoPrestamoTimestamp) || ultimoPrestamoTimestamp <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(ultimoPrestamoTimestamp) + PRESTAMO_COOLDOWN_SECS - nowSec);
}

/**
 * La cadena cuenta 48 h desde el pedido. La pantalla también cuenta 48 h
 * desde el pago que cierra el crédito: si no, el reloj solo se ve en el
 * primer ciclo, cuando el pago cae todavía dentro de esas 48 h.
 */
export function esperaParaVolverAPedir(
  ultimoPrestamoTimestamp: number,
  pagadoEn: number,
  nowSec: number = Math.floor(Date.now() / 1000)
): number {
  return Math.max(
    cooldownRestanteDesdeTimestamp(ultimoPrestamoTimestamp, nowSec),
    cooldownRestanteDesdeTimestamp(pagadoEn, nowSec)
  );
}
