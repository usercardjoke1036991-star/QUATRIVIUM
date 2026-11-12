/** Mientras el usuario está en la app de la billetera, no pedir la contraseña al volver. */
const HANDOFF_MS = 4 * 60 * 1000;

let untilMono = 0;

/** El plazo usa performance.now(). La hora del teléfono no alarga el traspaso. */
export function beginExternalWalletHandoff(mono = performance.now()): void {
  untilMono = mono + HANDOFF_MS;
}

export function externalWalletHandoffActive(mono = performance.now()): boolean {
  return untilMono > mono;
}

export function endExternalWalletHandoff(): void {
  untilMono = 0;
}
