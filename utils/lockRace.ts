let onLockFault: () => void = () => {};

/** La pantalla registra aquí el aviso traducido. Las pruebas pueden sustituirlo. */
export function setLockFaultReporter(report: (() => void) | null): void {
  onLockFault = report ?? (() => {});
}

/** Solo el camino del candado que antes tragaba el error. El resto de raceMs sigue en silencio. */
export function reportLockFault(): void {
  onLockFault();
}

/** El plazo agotado o un fallo de una lectura normal usa el valor de reserva, sin aviso. */
export function raceMs<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}
