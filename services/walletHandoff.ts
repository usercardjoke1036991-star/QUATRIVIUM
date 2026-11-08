/** Mientras el usuario está en la app de la billetera, no pedir la contraseña al volver. */
const HANDOFF_MS = 4 * 60 * 1000;

let until = 0;

export function beginExternalWalletHandoff(now = Date.now()): void {
  until = now + HANDOFF_MS;
}

export function externalWalletHandoffActive(now = Date.now()): boolean {
  return until > now;
}

export function endExternalWalletHandoff(): void {
  until = 0;
}
