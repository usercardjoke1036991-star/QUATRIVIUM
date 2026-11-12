let reportLockFault: () => void = () => {};

/** La pantalla registra aquí el aviso traducido. Las pruebas pueden sustituirlo. */
export function setLockFaultReporter(report: (() => void) | null): void {
  reportLockFault = report ?? (() => {});
}

/** Si la promesa falla, no se traga: avisa. El plazo agotado sigue en el valor de reserva. */
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
        reportLockFault();
        resolve(fallback);
      }
    );
  });
}
