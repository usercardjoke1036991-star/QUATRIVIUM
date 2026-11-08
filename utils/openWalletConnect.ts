import { syncAppKitNetwork } from '../web3Config';
import { beginExternalWalletHandoff } from '../services/walletHandoff';

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tx-timeout')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('tx-timeout'));
      }
    );
  });
}

/** Abre AppKit en la red del mundo activo (97 Demo, 56 Real). Cancelar no pinta error rojo. */
export async function openWalletConnect(open: () => unknown): Promise<boolean> {
  beginExternalWalletHandoff();
  try {
    await withTimeout(syncAppKitNetwork(), 8000).catch(() => undefined);
    await withTimeout(Promise.resolve(open()), 8000);
    return true;
  } catch {
    return false;
  }
}

/** La firma de WalletConnect caduca si la billetera no responde. No dejar el botón girando. */
export function withWalletSignTimeout<T>(work: Promise<T>, ms = 20000): Promise<T> {
  return withTimeout(work, ms);
}
