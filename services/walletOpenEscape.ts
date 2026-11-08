export type WalletOpenEscape = 'unlock' | 'restore';

type Listener = (kind: WalletOpenEscape) => void;

const listeners = new Set<Listener>();

export function subscribeWalletOpenEscape(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** La pantalla de fallo no puede ser un callejón: vuelve al candado o a Recuperar. */
export function requestWalletOpenEscape(kind: WalletOpenEscape): void {
  listeners.forEach((listener) => {
    try {
      listener(kind);
    } catch {
      // Un oyente no debe tumbar el resto.
    }
  });
}
